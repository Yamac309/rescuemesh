import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addResponderNote,
  confirmReport,
  createSocket,
  deleteAllReports,
  deleteDemoReports,
  getReports,
  getHealth,
  getNodeStatus,
  getReportComments,
  getVerificationConfig,
  postReportComment,
  responderRejectReport,
  responderVerifyReport,
  resolveReport,
  syncReports
} from "../api/client";
import {
  clearIgnoredReports,
  deleteAllReports as deleteAllLocalReports,
  deleteIgnoredReportIds,
  deleteDemoReports as deleteLocalDemoReports,
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
  const [commentsByReportId, setCommentsByReportId] = useState({});
  const [demoTimeOffsetHours, setDemoTimeOffsetHoursState] = useState(() => getDemoTimeOffsetHours());
  const [verificationConfig, setVerificationConfig] = useState(null);
  const clearInProgressRef = useRef(false);
  const demoRemovalInProgressRef = useRef(false);
  const reportsRef = useRef([]);
  const syncPromiseRef = useRef(null);
  const syncQueuedRef = useRef(false);
  const syncPausedRef = useRef(false);
  const reportIdsKey = useMemo(() => reports.map((report) => report.report_id).sort().join("|"), [reports]);

  useEffect(() => {
    reportsRef.current = reports;
  }, [reports]);

  const visibleReports = useCallback(
    (candidateReports, ignoredIds = ignoredReportIds) => {
      const ignored = new Set(ignoredIds);
      return sortByNewest(candidateReports.filter((report) => !ignored.has(report.report_id)));
    },
    [ignoredReportIds]
  );

  const mergeIntoState = useCallback(async (incomingReports) => {
    if (clearInProgressRef.current) return;
    const activeIncomingReports = demoRemovalInProgressRef.current
      ? incomingReports.filter((report) => !DEMO_REPORT_TITLES.includes(report.title))
      : incomingReports;
    const normalizedReports = activeIncomingReports.map(normalizeReport);
    await saveReports(normalizedReports);

    setReports((currentReports) => {
      if (clearInProgressRef.current) return [];
      const byId = new Map(currentReports.map((report) => [report.report_id, report]));
      normalizedReports.forEach((normalized) => {
        byId.set(normalized.report_id, mergeReport(byId.get(normalized.report_id), normalized));
      });
      const merged = [...byId.values()];
      return visibleReports(merged);
    });
  }, [visibleReports]);

  const removeFromState = useCallback(async (reportIds) => {
    if (!reportIds.length) return;
    await deleteReportsByIds(reportIds);
    await deleteIgnoredReportIds(reportIds);
    setIgnoredReportIds((currentIds) => currentIds.filter((reportId) => !reportIds.includes(reportId)));
    setCommentsByReportId((currentComments) => {
      const nextComments = { ...currentComments };
      reportIds.forEach((reportId) => delete nextComments[reportId]);
      return nextComments;
    });
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

  useEffect(() => {
    let cancelled = false;
    const reportIds = reportIdsKey ? reportIdsKey.split("|") : [];
    if (!reportIds.length) {
      setCommentsByReportId({});
      return () => {
        cancelled = true;
      };
    }

    Promise.all(
      reportIds.map((reportId) =>
        getReportComments(reportId)
          .then((comments) => [reportId, comments])
          .catch(() => [reportId, []])
      )
    ).then((entries) => {
      if (cancelled) return;
      setCommentsByReportId((currentComments) => {
        const activeReportIds = new Set(reportIds);
        const nextComments = Object.fromEntries(
          Object.entries(currentComments).filter(([reportId]) => activeReportIds.has(reportId))
        );
        entries.forEach(([reportId, comments]) => {
          nextComments[reportId] = comments;
        });
        return nextComments;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [reportIdsKey]);

  const mergeCommentIntoState = useCallback((comment) => {
    setCommentsByReportId((currentComments) => {
      const reportComments = currentComments[comment.report_id] || [];
      const byId = new Map(reportComments.map((item) => [item.comment_id, item]));
      byId.set(comment.comment_id, comment);
      return {
        ...currentComments,
        [comment.report_id]: [...byId.values()].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
      };
    });
  }, []);

  const refreshNodeStatus = useCallback(async () => {
    try {
      const [status] = await Promise.all([getNodeStatus(), getHealth()]);
      setNodeStatus(status);
      setBackendOnline(true);
      return status;
    } catch {
      setBackendOnline(false);
      setNodeStatus((current) => current || { backend_health: "ok", connected_clients: 0, total_reports: reportsRef.current.length });
      return null;
    }
  }, []);

  const replayQueuedActions = useCallback(async () => {
    const actions = await getQueuedActions();
    const localReportIds = new Set((await getAllReports()).map((report) => report.report_id));
    for (const action of actions) {
      if (!localReportIds.has(action.report_id)) {
        await deleteQueuedAction(action.id);
        continue;
      }

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
      } catch (error) {
        if (error.status === 404) {
          await deleteQueuedAction(action.id);
          continue;
        }
        break;
      }
    }
  }, [mergeIntoState]);

  const runSyncCycle = useCallback(async () => {
    if (clearInProgressRef.current || demoRemovalInProgressRef.current) return;
    const localReports = await getAllReports();
    const knownIds = localReports.map((report) => report.report_id);

    try {
      if (clearInProgressRef.current || demoRemovalInProgressRef.current) return;
      const response = await syncReports(knownIds, localReports);
      if (clearInProgressRef.current || demoRemovalInProgressRef.current) return;
      if (response.deleted_report_ids?.length) {
        await removeFromState(response.deleted_report_ids);
      }
      const deletedIds = new Set(response.deleted_report_ids || []);
      const syncedLocal = localReports.map((report) => ({ ...report, sync_state: "synced" }));
      const activeSyncedLocal = syncedLocal.filter((report) => !deletedIds.has(report.report_id));
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

  const syncNow = useCallback(async () => {
    if (clearInProgressRef.current || demoRemovalInProgressRef.current) return null;
    if (syncPausedRef.current) {
      syncQueuedRef.current = true;
      return null;
    }

    if (syncPromiseRef.current) {
      syncQueuedRef.current = true;
      return syncPromiseRef.current;
    }

    const runQueuedSyncs = async () => {
      do {
        syncQueuedRef.current = false;
        if (!syncPausedRef.current) {
          await runSyncCycle();
        }
      } while (syncQueuedRef.current && !syncPausedRef.current);
    };

    syncPromiseRef.current = runQueuedSyncs().finally(() => {
      syncPromiseRef.current = null;
    });
    return syncPromiseRef.current;
  }, [runSyncCycle]);

  useEffect(() => {
    syncNow();
    const interval = window.setInterval(syncNow, 30000);
    return () => window.clearInterval(interval);
  }, [syncNow]);

  useEffect(() => {
    let socket;
    let retryTimer;
    let stopped = false;

    function connect() {
      if (stopped) return;
      try {
        socket = createSocket();
        socket.onopen = () => {
          if (!stopped) setBackendOnline(true);
        };
        socket.onmessage = (event) => {
          if (stopped) return;
          const message = JSON.parse(event.data);
          if (message.report) {
            mergeIntoState([message.report]);
          }
          if (message.type === "reports:deleted" && message.report_ids) {
            removeFromState(message.report_ids);
          }
          if (message.type === "comment:new" && message.comment) {
            mergeCommentIntoState(message.comment);
          }
        };
        socket.onclose = () => {
          if (stopped) return;
          setBackendOnline(false);
          retryTimer = window.setTimeout(connect, 5000);
        };
      } catch {
        if (!stopped) retryTimer = window.setTimeout(connect, 5000);
      }
    }

    connect();
    return () => {
      stopped = true;
      window.clearTimeout(retryTimer);
      if (socket) {
        socket.onclose = null;
        socket.close();
      }
    };
  }, [mergeIntoState, mergeCommentIntoState, removeFromState]);

  const createLocalReport = useCallback(
    async (report) => {
      const duplicate = findPossibleDuplicate(report, reports);
      const locallyVerifiedReport = estimateLocalVerification(
        { ...report, sync_state: "pending" },
        reports,
        verificationConfig
      );
      await saveReport(locallyVerifiedReport);
      await mergeIntoState([locallyVerifiedReport]);
      try {
        const response = await syncReports([report.report_id], [locallyVerifiedReport]);
        if (response.deleted_report_ids?.includes(report.report_id)) {
          await removeFromState([report.report_id]);
          throw new Error("This report was already deleted on the RescueMesh Node.");
        }
        await mergeIntoState([
          ...response.accepted_reports,
          ...response.missing_reports
        ]);
        const serverReports = await getReports();
        await saveReports(serverReports);
        await mergeIntoState(serverReports);
        await refreshNodeStatus();
      } catch (error) {
        console.warn("Report was saved locally but could not sync immediately.", error);
        syncNow();
      }
      return duplicate;
    },
    [mergeIntoState, refreshNodeStatus, removeFromState, reports, syncNow, verificationConfig]
  );

  const createLocalReports = useCallback(
    async (nextReports) => {
      const existingReports = reportsRef.current;
      const locallyVerifiedReports = nextReports.map((report) =>
        estimateLocalVerification({ ...report, sync_state: "pending" }, existingReports, verificationConfig)
      );
      await mergeIntoState(locallyVerifiedReports);
      syncNow();
    },
    [mergeIntoState, syncNow, verificationConfig]
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

  const addCommentToReport = useCallback(
    async (reportId, body) => {
      const comment = {
        comment_id: `comment-${deviceId}-${Date.now()}-${crypto.randomUUID()}`,
        report_id: reportId,
        body,
        device_id: deviceId,
        timestamp: new Date().toISOString()
      };
      mergeCommentIntoState(comment);
      try {
        const savedComment = await postReportComment(reportId, comment);
        mergeCommentIntoState(savedComment);
      } catch (error) {
        console.error("Unable to save comment", error);
      }
    },
    [deviceId, mergeCommentIntoState]
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
    demoRemovalInProgressRef.current = true;
    syncPausedRef.current = true;
    syncQueuedRef.current = false;
    if (syncPromiseRef.current) {
      await syncPromiseRef.current.catch(() => {});
    }

    const demoReportIds = reportsRef.current
      .filter((report) => DEMO_REPORT_TITLES.includes(report.title))
      .map((report) => report.report_id);
    let localDeletedIds = [];
    try {
      localDeletedIds = await deleteLocalDemoReports();
      if (!localDeletedIds.length) {
        localDeletedIds = await deleteReportsByTitles(DEMO_REPORT_TITLES);
      }
      const localDeleted = new Set([...demoReportIds, ...localDeletedIds]);
      setReports((currentReports) =>
        currentReports.filter((report) => !localDeleted.has(report.report_id) && !DEMO_REPORT_TITLES.includes(report.title))
      );
      const response = await deleteDemoReports([...localDeleted]);
      await removeFromState(response.deleted_report_ids || [...localDeleted]);
      await refreshNodeStatus();
    } catch {
      console.warn(`Removed ${localDeletedIds.length} local demo reports. Node cleanup will need a connection.`);
    } finally {
      demoRemovalInProgressRef.current = false;
      syncPausedRef.current = false;
      syncQueuedRef.current = false;
      await syncNow();
    }
  }, [refreshNodeStatus, removeFromState, syncNow]);

  const clearAllReports = useCallback(async () => {
    const localReportIds = reports.map((report) => report.report_id);
    let backendCleared = false;
    clearInProgressRef.current = true;
    syncPausedRef.current = true;
    syncQueuedRef.current = false;
    if (syncPromiseRef.current) {
      await syncPromiseRef.current.catch(() => {});
    }
    setReports([]);
    setIgnoredReportIds([]);
    setNodeStatus((current) => (current ? { ...current, total_reports: 0 } : current));

    try {
      await deleteAllLocalReports();
      await clearIgnoredReports();
      setCommentsByReportId({});
      const response = await deleteAllReports();
      backendCleared = true;
      await removeFromState(response.deleted_report_ids || localReportIds);
      await refreshNodeStatus();
    } catch {
      await deleteAllLocalReports();
      await clearIgnoredReports();
      setCommentsByReportId({});
      console.warn(`Cleared ${localReportIds.length} local reports. Node cleanup will need a connection.`);
    } finally {
      clearInProgressRef.current = false;
      syncPausedRef.current = false;
      syncQueuedRef.current = false;
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
      commentsByReportId,
      demoTimeOffsetHours,
      createLocalReport,
      createLocalReports,
      confirmLocalReport,
      resolveLocalReport,
      responderVerifyLocalReport,
      responderRejectLocalReport,
      addResponderNoteToReport,
      addCommentToReport,
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
      commentsByReportId,
      demoTimeOffsetHours,
      createLocalReport,
      createLocalReports,
      confirmLocalReport,
      resolveLocalReport,
      responderVerifyLocalReport,
      responderRejectLocalReport,
      addResponderNoteToReport,
      addCommentToReport,
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
