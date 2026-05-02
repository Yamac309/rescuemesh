import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addResponderNote,
  confirmReport,
  createSocket,
  deleteAllReports,
  deleteDemoReports,
  getHealth,
  getNodeStatus,
  getVerificationConfig,
  responderRejectReport,
  responderVerifyReport,
  resolveReport,
  syncReports
} from "../api/client";
import {
  clearIgnoredReports,
  deleteAllReports as deleteAllLocalReports,
  deleteIgnoredReportIds,
  deleteQueuedAction,
  deleteReportsByIds,
  deleteReportsByTitles,
  getAllReports,
  getDeviceId,
  getIgnoredReportIds,
  getQueuedActions,
  ignoreReport,
  queueAction,
  saveReport,
  saveReports
} from "../storage/indexedDb";
import { DEMO_REPORT_TITLES } from "../utils/demoData";
import {
  DEMO_TIME_OFFSET_KEY,
  estimateLocalVerification,
  findPossibleDuplicate,
  getDemoTimeOffsetHours,
  mergeReport,
  normalizeReport,
  sortByNewest
} from "../utils/reportUtils";

export function useReports() {
  const [reports, setReports] = useState([]);
  const [deviceId] = useState(() => getDeviceId());
  const [lastSyncTime, setLastSyncTime] = useState(null);
  const [backendOnline, setBackendOnline] = useState(false);
  const [nodeStatus, setNodeStatus] = useState(null);
  const [ignoredReportIds, setIgnoredReportIds] = useState([]);
  const [demoTimeOffsetHours, setDemoTimeOffsetHoursState] = useState(() => getDemoTimeOffsetHours());
  const [verificationConfig, setVerificationConfig] = useState(null);
  const clearInProgressRef = useRef(false);

  const visibleReports = useCallback(
    (candidateReports, ignoredIds = ignoredReportIds) => {
      const ignored = new Set(ignoredIds);
      return sortByNewest(candidateReports.filter((report) => !ignored.has(report.report_id)));
    },
    [ignoredReportIds]
  );

  const mergeIntoState = useCallback(async (incomingReports) => {
    if (clearInProgressRef.current) return;
    setReports((currentReports) => {
      if (clearInProgressRef.current) return [];
      const byId = new Map(currentReports.map((report) => [report.report_id, report]));
      incomingReports.forEach((incoming) => {
        const normalized = normalizeReport(incoming);
        byId.set(normalized.report_id, mergeReport(byId.get(normalized.report_id), normalized));
      });
      const merged = [...byId.values()];
      saveReports(incomingReports).catch((error) => console.error("Unable to save reports locally", error));
      return visibleReports(merged);
    });
  }, [visibleReports]);

  const removeFromState = useCallback(async (reportIds) => {
    if (!reportIds.length) return;
    await deleteReportsByIds(reportIds);
    await deleteIgnoredReportIds(reportIds);
    setIgnoredReportIds((currentIds) => currentIds.filter((reportId) => !reportIds.includes(reportId)));
    setReports((currentReports) => currentReports.filter((report) => !reportIds.includes(report.report_id)));
  }, []);

  useEffect(() => {
    Promise.all([getAllReports(), getIgnoredReportIds()])
      .then(([localReports, ignoredIds]) => {
        setIgnoredReportIds(ignoredIds);
        setReports(visibleReports(localReports, ignoredIds));
      })
      .catch((error) => console.error("Unable to read local storage", error));
  }, [visibleReports]);

  useEffect(() => {
    getVerificationConfig()
      .then(setVerificationConfig)
      .catch(() => setVerificationConfig(null));
  }, []);

  const refreshNodeStatus = useCallback(async () => {
    try {
      const [status] = await Promise.all([getNodeStatus(), getHealth()]);
      setNodeStatus(status);
      setBackendOnline(true);
      return status;
    } catch {
      setBackendOnline(false);
      setNodeStatus((current) => current || { backend_health: "ok", connected_clients: 0, total_reports: reports.length });
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
    if (clearInProgressRef.current) return;
    const localReports = await getAllReports();
    const knownIds = localReports.map((report) => report.report_id);

    try {
      if (clearInProgressRef.current) return;
      const response = await syncReports(knownIds, localReports);
      if (clearInProgressRef.current) return;
      if (response.deleted_report_ids?.length) {
        await removeFromState(response.deleted_report_ids);
      }
      const deletedIds = new Set(response.deleted_report_ids || []);
      const syncedLocal = localReports.map((report) => ({ ...report, sync_state: "synced" }));
      const activeSyncedLocal = syncedLocal.filter((report) => !deletedIds.has(report.report_id));
      await saveReports([...activeSyncedLocal, ...response.missing_reports, ...response.accepted_reports]);
      await mergeIntoState([...activeSyncedLocal, ...response.missing_reports, ...response.accepted_reports]);
      await replayQueuedActions();
      await refreshNodeStatus();
      setBackendOnline(true);
      const syncedAt = new Date();
      setLastSyncTime(syncedAt.toISOString());
    } catch {
      setBackendOnline(false);
    }
  }, [mergeIntoState, refreshNodeStatus, removeFromState, replayQueuedActions]);

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
      const locallyVerifiedReport = estimateLocalVerification({ ...report, sync_state: "pending" }, reports, verificationConfig);
      await saveReport(locallyVerifiedReport);
      await mergeIntoState([locallyVerifiedReport]);
      syncNow();
      return duplicate;
    },
    [mergeIntoState, reports, syncNow, verificationConfig]
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

  const responderVerifyLocalReport = useCallback(
    async (reportId) => {
      const updated = await responderVerifyReport(reportId);
      await mergeIntoState([updated]);
    },
    [mergeIntoState]
  );

  const responderRejectLocalReport = useCallback(
    async (reportId) => {
      const updated = await responderRejectReport(reportId);
      await mergeIntoState([updated]);
    },
    [mergeIntoState]
  );

  const addResponderNoteToReport = useCallback(
    async (reportId, note) => {
      const updated = await addResponderNote(reportId, note);
      await mergeIntoState([updated]);
    },
    [mergeIntoState]
  );

  const ignoreLocalReport = useCallback(
    async (reportId) => {
      await ignoreReport(reportId);
      setIgnoredReportIds((currentIds) => (currentIds.includes(reportId) ? currentIds : [...currentIds, reportId]));
      setReports((currentReports) => currentReports.filter((report) => report.report_id !== reportId));
    },
    []
  );

  const removeDemoReports = useCallback(async () => {
    const localDeletedIds = await deleteReportsByTitles(DEMO_REPORT_TITLES);
    setReports((currentReports) => currentReports.filter((report) => !DEMO_REPORT_TITLES.includes(report.title)));

    try {
      const response = await deleteDemoReports();
      await removeFromState(response.deleted_report_ids || []);
      await refreshNodeStatus();
    } catch {
      console.warn(`Removed ${localDeletedIds.length} local demo reports. Node cleanup will need a connection.`);
    }
  }, [refreshNodeStatus, removeFromState]);

  const clearAllReports = useCallback(async () => {
    const localReportIds = reports.map((report) => report.report_id);
    let backendCleared = false;
    clearInProgressRef.current = true;
    setReports([]);
    setIgnoredReportIds([]);
    setNodeStatus((current) => current ? { ...current, total_reports: 0 } : current);

    try {
      await deleteAllLocalReports();
      await clearIgnoredReports();
      const response = await deleteAllReports();
      backendCleared = true;
      await removeFromState(response.deleted_report_ids || localReportIds);
      await refreshNodeStatus();
    } catch {
      await deleteAllLocalReports();
      await clearIgnoredReports();
      console.warn(`Cleared ${localReportIds.length} local reports. Node cleanup will need a connection.`);
    } finally {
      clearInProgressRef.current = false;
      if (backendCleared) {
        await syncNow();
      }
    }
  }, [refreshNodeStatus, removeFromState, reports, syncNow]);

  const setDemoTimeOffsetHours = useCallback((hours) => {
    const nextHours = Number(hours);
    localStorage.setItem(DEMO_TIME_OFFSET_KEY, String(nextHours));
    setDemoTimeOffsetHoursState(nextHours);
  }, []);

  const value = useMemo(
    () => ({
      reports,
      deviceId,
      lastSyncTime,
      backendOnline,
      nodeStatus,
      demoTimeOffsetHours,
      createLocalReport,
      confirmLocalReport,
      resolveLocalReport,
      responderVerifyLocalReport,
      responderRejectLocalReport,
      addResponderNoteToReport,
      ignoreLocalReport,
      removeDemoReports,
      clearAllReports,
      setDemoTimeOffsetHours,
      syncNow,
      refreshNodeStatus,
      mergeIntoState
    }),
    [
      reports,
      deviceId,
      lastSyncTime,
      backendOnline,
      nodeStatus,
      demoTimeOffsetHours,
      createLocalReport,
      confirmLocalReport,
      resolveLocalReport,
      responderVerifyLocalReport,
      responderRejectLocalReport,
      addResponderNoteToReport,
      ignoreLocalReport,
      removeDemoReports,
      clearAllReports,
      setDemoTimeOffsetHours,
      syncNow,
      refreshNodeStatus,
      mergeIntoState
    ]
  );

  return value;
}
