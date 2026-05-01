import { useCallback, useEffect, useMemo, useState } from "react";
import { confirmReport, createSocket, deleteAllReports, deleteDemoReports, getHealth, getNodeStatus, resolveReport, syncReports } from "../api/client";
import {
  deleteAllReports as deleteAllLocalReports,
  deleteQueuedAction,
  deleteReportsByIds,
  deleteReportsByTitles,
  getAllReports,
  getDeviceId,
  getQueuedActions,
  queueAction,
  saveReport,
  saveReports
} from "../storage/indexedDb";
import { DEMO_REPORT_TITLES } from "../utils/demoData";
import { findPossibleDuplicate, mergeReport, normalizeReport, sortByNewest } from "../utils/reportUtils";

export function useReports() {
  const [reports, setReports] = useState([]);
  const [deviceId] = useState(() => getDeviceId());
  const [syncStatus, setSyncStatus] = useState("Loading local cache");
  const [lastSyncTime, setLastSyncTime] = useState(null);
  const [backendOnline, setBackendOnline] = useState(false);
  const [nodeStatus, setNodeStatus] = useState(null);

  const mergeIntoState = useCallback(async (incomingReports) => {
    setReports((currentReports) => {
      const byId = new Map(currentReports.map((report) => [report.report_id, report]));
      incomingReports.forEach((incoming) => {
        const normalized = normalizeReport(incoming);
        byId.set(normalized.report_id, mergeReport(byId.get(normalized.report_id), normalized));
      });
      const merged = sortByNewest([...byId.values()]);
      saveReports(merged).catch((error) => console.error("Unable to save reports locally", error));
      return merged;
    });
  }, []);

  const removeFromState = useCallback(async (reportIds) => {
    if (!reportIds.length) return;
    await deleteReportsByIds(reportIds);
    setReports((currentReports) => currentReports.filter((report) => !reportIds.includes(report.report_id)));
  }, []);

  useEffect(() => {
    getAllReports()
      .then((localReports) => {
        setReports(sortByNewest(localReports));
        setSyncStatus(localReports.length ? "Loaded from this device" : "Ready for reports");
      })
      .catch(() => setSyncStatus("Unable to read local storage"));
  }, []);

  const refreshNodeStatus = useCallback(async () => {
    try {
      const [status] = await Promise.all([getNodeStatus(), getHealth()]);
      setNodeStatus(status);
      setBackendOnline(true);
      return status;
    } catch {
      setBackendOnline(false);
      setNodeStatus((current) => current || { backend_health: "offline", connected_clients: 0, total_reports: reports.length });
      return null;
    }
  }, [reports.length]);

  const replayQueuedActions = useCallback(async () => {
    const actions = await getQueuedActions();
    for (const action of actions) {
      try {
        if (action.type === "confirm") {
          const updated = await confirmReport(action.report_id, action.device_id);
          await mergeIntoState([updated]);
        }
        if (action.type === "resolve") {
          const updated = await resolveReport(action.report_id);
          await mergeIntoState([updated]);
        }
        await deleteQueuedAction(action.id);
      } catch {
        break;
      }
    }
  }, [mergeIntoState]);

  const syncNow = useCallback(async () => {
    const localReports = await getAllReports();
    const knownIds = localReports.map((report) => report.report_id);
    setSyncStatus("Syncing with local node");

    try {
      const response = await syncReports(knownIds, localReports);
      const syncedLocal = localReports.map((report) => ({ ...report, sync_state: "synced" }));
      await saveReports([...syncedLocal, ...response.missing_reports, ...response.accepted_reports]);
      await mergeIntoState([...syncedLocal, ...response.missing_reports, ...response.accepted_reports]);
      await replayQueuedActions();
      await refreshNodeStatus();
      setBackendOnline(true);
      setLastSyncTime(new Date().toISOString());
      setSyncStatus(`Synced ${response.total_reports} reports with node`);
    } catch {
      setBackendOnline(false);
      setSyncStatus("Offline mode: reports are saved on this device");
    }
  }, [mergeIntoState, refreshNodeStatus, replayQueuedActions]);

  useEffect(() => {
    syncNow();
    const interval = window.setInterval(syncNow, 30000);
    return () => window.clearInterval(interval);
  }, [syncNow]);

  useEffect(() => {
    let socket;
    let retryTimer;

    function connect() {
      try {
        socket = createSocket();
        socket.onopen = () => setBackendOnline(true);
        socket.onmessage = (event) => {
          const message = JSON.parse(event.data);
          if (message.report) {
            mergeIntoState([message.report]);
          }
          if (message.type === "reports:deleted" && message.report_ids) {
            removeFromState(message.report_ids);
          }
        };
        socket.onclose = () => {
          setBackendOnline(false);
          retryTimer = window.setTimeout(connect, 5000);
        };
      } catch {
        retryTimer = window.setTimeout(connect, 5000);
      }
    }

    connect();
    return () => {
      window.clearTimeout(retryTimer);
      if (socket) socket.close();
    };
  }, [mergeIntoState, removeFromState]);

  const createLocalReport = useCallback(
    async (report) => {
      const duplicate = findPossibleDuplicate(report, reports);
      await saveReport(report);
      await mergeIntoState([{ ...report, sync_state: "pending" }]);
      syncNow();
      return duplicate;
    },
    [mergeIntoState, reports, syncNow]
  );

  const confirmLocalReport = useCallback(
    async (reportId) => {
      const report = reports.find((item) => item.report_id === reportId);
      if (!report || report.confirmed_by_device_ids?.includes(deviceId)) return;

      const confirmedBy = [...(report.confirmed_by_device_ids || []), deviceId];
      const localCount = Math.max(report.confirmation_count || 0, confirmedBy.length);
      const localReport = {
        ...report,
        confirmed_by_device_ids: confirmedBy,
        confirmation_count: localCount,
        status: localCount >= 2 && report.status !== "Resolved" ? "Confirmed" : report.status
      };
      await saveReport(localReport);
      await mergeIntoState([localReport]);

      try {
        const updated = await confirmReport(reportId, deviceId);
        await mergeIntoState([{ ...updated, confirmed_by_device_ids: confirmedBy }]);
      } catch {
        await queueAction({ type: "confirm", report_id: reportId, device_id: deviceId });
      }
    },
    [deviceId, mergeIntoState, reports]
  );

  const resolveLocalReport = useCallback(
    async (reportId) => {
      const report = reports.find((item) => item.report_id === reportId);
      if (!report) return;

      const localReport = { ...report, status: "Resolved" };
      await saveReport(localReport);
      await mergeIntoState([localReport]);

      try {
        const updated = await resolveReport(reportId);
        await mergeIntoState([updated]);
      } catch {
        await queueAction({ type: "resolve", report_id: reportId });
      }
    },
    [mergeIntoState, reports]
  );

  const removeDemoReports = useCallback(async () => {
    const localDeletedIds = await deleteReportsByTitles(DEMO_REPORT_TITLES);
    setReports((currentReports) => currentReports.filter((report) => !DEMO_REPORT_TITLES.includes(report.title)));

    try {
      const response = await deleteDemoReports();
      await removeFromState(response.deleted_report_ids || []);
      await refreshNodeStatus();
      setSyncStatus(`Removed ${Math.max(localDeletedIds.length, response.deleted_count || 0)} demo reports`);
    } catch {
      setSyncStatus(`Removed ${localDeletedIds.length} local demo reports. Node cleanup will need a connection.`);
    }
  }, [refreshNodeStatus, removeFromState]);

  const clearAllReports = useCallback(async () => {
    const localReportIds = reports.map((report) => report.report_id);
    await deleteAllLocalReports();
    setReports([]);

    try {
      const response = await deleteAllReports();
      await removeFromState(response.deleted_report_ids || localReportIds);
      await refreshNodeStatus();
      setSyncStatus(`Cleared ${Math.max(localReportIds.length, response.deleted_count || 0)} reports`);
    } catch {
      setSyncStatus(`Cleared ${localReportIds.length} local reports. Node cleanup will need a connection.`);
    }
  }, [refreshNodeStatus, removeFromState, reports]);

  const value = useMemo(
    () => ({
      reports,
      deviceId,
      syncStatus,
      lastSyncTime,
      backendOnline,
      nodeStatus,
      createLocalReport,
      confirmLocalReport,
      resolveLocalReport,
      removeDemoReports,
      clearAllReports,
      syncNow,
      refreshNodeStatus,
      mergeIntoState
    }),
    [
      reports,
      deviceId,
      syncStatus,
      lastSyncTime,
      backendOnline,
      nodeStatus,
      createLocalReport,
      confirmLocalReport,
      resolveLocalReport,
      removeDemoReports,
      clearAllReports,
      syncNow,
      refreshNodeStatus,
      mergeIntoState
    ]
  );

  return value;
}
