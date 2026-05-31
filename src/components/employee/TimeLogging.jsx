import React, { useState, useEffect, useRef } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend
} from 'chart.js';
import { Bar } from 'react-chartjs-2';
import '../../styles/timelogging.css';
// v4.3: stamp times in the office zone (App.jsx handles the timezone +
// internet sync at app start; we just consume the cached values here).
import { getOfficeHHMM, getOfficeDate } from '../../utils/officeTime';
// v4.3: PDF export of the activity graph (printing produced a blank page).
import { generatePdf } from '../../utils/pdf/pdfGenerator';

// Register Chart.js components (must run once on module load)
ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

function TimeLogging({ user, canEdit = false }) {
  const [selectedDate, setSelectedDate] = useState(getOfficeDate());
  const [timeLog, setTimeLog] = useState({
    startTime: '',
    breakStartTime: '',
    breakEndTime: '',
    endTime: ''
  });
  const [timeLogs, setTimeLogs] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [editValues, setEditValues] = useState({});
  const [validationErrors, setValidationErrors] = useState({});
  const [successMessage, setSuccessMessage] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(null);
  const [loading, setLoading] = useState(false);

  // Event logging states
  const [showEventModal, setShowEventModal] = useState(false);
  const [showGraphModal, setShowGraphModal] = useState(false);
  const [events, setEvents] = useState([]);
  // 'day', 'week' (last 7 days), 'month' (last 30 days), 'compare' (last 2 weeks side-by-side)
  const [graphRange, setGraphRange] = useState('day');
  const [rangeEvents, setRangeEvents] = useState([]);
  // For 'compare' view, we split the 14 days into two buckets
  const [compareEvents, setCompareEvents] = useState({ thisWeek: [], lastWeek: [] });
  const [rangeLoading, setRangeLoading] = useState(false);
  const [eventForm, setEventForm] = useState({
    time: '',
    endTime: '',
    activityType: 'admin_work',
    notes: ''
  });

  // Predefined activity types (matches business categories defined by ops)
  const activityTypes = [
    { id: 'admin_work',        label: '📋 Admin work' },
    { id: 'file_work',         label: '🗂️ File Work' },
    { id: 'break',             label: '☕ Break' },
    { id: 'calls',             label: '📞 Calls (bank/client)' },
    { id: 'compliance',        label: '🛡️ Compliance' },
    { id: 'internal_meeting',  label: '👥 Internal meeting' },
    { id: 'external_meeting',  label: '🤝 External meeting' },
    { id: 'training_given',    label: '🎓 Training Given' },
    { id: 'training_received', label: '📚 Training received' },
    { id: 'social_media',      label: '📱 Social media' },
    { id: 'asset_finance',     label: '💰 Asset finance' },
    { id: 'unforced_break',    label: '⛔ Unforced break' }
  ];

  // Calculate duration between two HH:MM strings. Returns a string like
  // "0.42h (25 min)" so both the fractional-hours figure (consistent with the
  // other duration displays) and the human-friendly minute count are shown.
  // Returns null when start/end are missing or the range is non-positive.
  const calcEventDuration = (start, end) => {
    if (!start || !end) return null;
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    const mins = (eh * 60 + em) - (sh * 60 + sm);
    if (mins <= 0) return null;
    return `${(mins / 60).toFixed(2)}h (${mins} min)`;
  };

  // Load time logs and events for the selected date
  useEffect(() => {
    loadTimeLogs();
    loadEvents();
  }, [selectedDate]);


  // DB stores times as HH:MM:SS but the inputs/comparisons use HH:MM. Trim
  // the seconds on load so the form shows the value the user actually typed
  // (and so the auto-pad logic doesn't have a 5-char vs 8-char mismatch).
  const trimSeconds = (v) => {
    if (!v || typeof v !== 'string') return '';
    const m = v.match(/^(\d{1,2}:\d{2})/);
    return m ? m[1] : v;
  };

  const loadTimeLogs = async () => {
    try {
      setLoading(true);
      const result = await window.electron.getTimeLogs(user.id, selectedDate, selectedDate);
      if (result.success) {
        setTimeLogs(result.data);
        if (result.data.length > 0) {
          const log = result.data[0];
          setTimeLog({
            startTime:      trimSeconds(log.startTime),
            breakStartTime: trimSeconds(log.breakStartTime),
            breakEndTime:   trimSeconds(log.breakEndTime),
            endTime:        trimSeconds(log.endTime)
          });
        } else {
          setTimeLog({
            startTime: '',
            breakStartTime: '',
            breakEndTime: '',
            endTime: ''
          });
        }
      }
    } catch (error) {
      console.error('Error loading time logs:', error);
    } finally {
      setLoading(false);
    }
  };

  const validateTimes = (times) => {
    const errors = {};

    if (!times.startTime) {
      errors.startTime = 'Start time is required';
    }

    if (times.breakStartTime && !times.breakEndTime) {
      errors.breakEndTime = 'Break end time is required if break start time is set';
    }

    if (times.breakEndTime && !times.breakStartTime) {
      errors.breakStartTime = 'Break start time is required if break end time is set';
    }

    if (!times.endTime) {
      errors.endTime = 'End time is required';
    }

    // Time ordering validation
    if (times.startTime && times.endTime) {
      if (times.startTime >= times.endTime) {
        errors.endTime = 'End time must be after start time';
      }
    }

    if (times.breakStartTime && times.breakEndTime) {
      if (times.breakStartTime >= times.breakEndTime) {
        errors.breakEndTime = 'Break end time must be after break start time';
      }

      // Check break is within work hours
      if (times.startTime && times.endTime) {
        if (times.breakStartTime < times.startTime) {
          errors.breakStartTime = 'Break cannot start before work starts';
        }
        if (times.breakEndTime > times.endTime) {
          errors.breakEndTime = 'Break cannot end after work ends';
        }
      }
    }

    return errors;
  };

  // v4.2: also accepts a precomputed `extraBreakMinutes` so additional break
  // windows (typically logged as activity events of type 'break') roll up
  // into the same break / net-hours totals as the primary time_logs break
  // window. Caller is responsible for ensuring those events belong to the
  // same day as `times` so the sum is meaningful.
  const calculateDurations = (times, extraBreakMinutes = 0) => {
    if (!times.startTime || !times.endTime) {
      return { workingHours: 0, breakDuration: 0, netWorkingHours: 0 };
    }

    const start = new Date(`2000-01-01T${times.startTime}`);
    const end = new Date(`2000-01-01T${times.endTime}`);
    const workingMinutes = (end - start) / (1000 * 60);
    const workingHours = workingMinutes / 60;

    let breakMinutes = 0;
    if (times.breakStartTime && times.breakEndTime) {
      const breakStart = new Date(`2000-01-01T${times.breakStartTime}`);
      const breakEnd = new Date(`2000-01-01T${times.breakEndTime}`);
      breakMinutes = (breakEnd - breakStart) / (1000 * 60);
    }

    // Add any extra break minutes from break-typed events.
    breakMinutes += Math.max(0, Number(extraBreakMinutes) || 0);

    const netWorkingHours = (workingMinutes - breakMinutes) / 60;

    return {
      workingHours: parseFloat(workingHours.toFixed(2)),
      breakDuration: parseFloat((breakMinutes / 60).toFixed(2)),
      netWorkingHours: parseFloat(netWorkingHours.toFixed(2))
    };
  };

  // v4.2: sum up break-typed activity events (each has a start time, and
  // optionally an end time). Events with no endTime are skipped — we can't
  // know how long the break was. Events spanning midnight are clamped to a
  // single-day window since the underlying TIME columns don't carry a date.
  const sumBreakEventMinutes = (eventList) => {
    if (!Array.isArray(eventList)) return 0;
    let total = 0;
    for (const ev of eventList) {
      if (!ev || ev.activityType !== 'break') continue;
      const startStr = (ev.time || '').slice(0, 5);
      const endStr   = (ev.endTime || '').slice(0, 5);
      if (!startStr || !endStr) continue;
      const s = new Date(`2000-01-01T${startStr}`);
      const e = new Date(`2000-01-01T${endStr}`);
      const mins = (e - s) / (1000 * 60);
      if (mins > 0) total += mins;
    }
    return total;
  };

  const getCurrentStatus = (times) => {
    const now = new Date();
    const currentTime = now.toTimeString().slice(0, 5);

    if (!times.startTime) return 'Not Started';
    if (times.breakStartTime && times.breakEndTime) {
      if (currentTime >= times.breakStartTime && currentTime < times.breakEndTime) {
        return 'On Break';
      }
    }
    if (times.endTime && currentTime >= times.endTime) {
      return 'Finished for the day';
    }
    return 'Currently Working';
  };

  // Normalises free-text time entry so users can type "9:30" and have it
  // stored as "09:30". Without padding, string-based time comparisons (e.g.
  // "9:30" >= "17:30") return wrong results because "9" > "1" lexically.
  // Only normalises once the value matches "H:MM" or "HH:MM" — partial
  // input like "9" or "9:" is left alone so the user can keep typing.
  const normalizeTime = (val) => {
    if (!val || typeof val !== 'string') return val;
    const m = val.match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return val;
    const hh = String(parseInt(m[1], 10)).padStart(2, '0');
    return `${hh}:${m[2]}`;
  };

  const handleInputChange = (field, value) => {
    const normalised = normalizeTime(value);
    const updated = { ...timeLog, [field]: normalised };
    setTimeLog(updated);
    setValidationErrors(validateTimes(updated));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const errors = validateTimes(timeLog);

    if (Object.keys(errors).length > 0) {
      setValidationErrors(errors);
      return;
    }

    try {
      setLoading(true);
      const result = await window.electron.createTimeLog(
        user.id,
        selectedDate,
        timeLog.startTime,
        timeLog.breakStartTime,
        timeLog.breakEndTime,
        timeLog.endTime
      );

      if (result.success) {
        setSuccessMessage('Time log saved successfully!');
        setTimeout(() => setSuccessMessage(''), 3000);
        // Mirror the user's break window into the events log so it shows up
        // in the Daily Activity Log AND in the timeline graph.
        await syncBreakAsEvent(timeLog.breakStartTime, timeLog.breakEndTime);
        await loadTimeLogs();
        await loadEvents();
      } else {
        // Silent failure used to leave the user with no feedback — now they
        // see what actually went wrong so they can correct it.
        setValidationErrors({ general: result.message || result.error || 'Failed to save time log' });
      }
    } catch (error) {
      console.error('Error saving time log:', error);
      setValidationErrors({ general: 'Failed to save time log: ' + error.message });
    } finally {
      setLoading(false);
    }
  };

  // v4.1: button-based time logging. Each click stamps the current local time
  // into the named field and immediately UPSERTs the day's time_log row, so
  // the user never has to type a time or hit "Save". `field` is one of
  // 'startTime' / 'breakStartTime' / 'breakEndTime' / 'endTime'.
  const stampNow = async (field) => {
    if (loading) return;
    // Office-zone stamp (default Europe/London) so a laptop set to a
    // different timezone doesn't write 19:00 when it's actually 09:00 in
    // the office.
    const hhmm = getOfficeHHMM();
    const next = { ...timeLog, [field]: hhmm };
    setTimeLog(next);
    setValidationErrors({});
    try {
      setLoading(true);
      const result = await window.electron.createTimeLog(
        user.id,
        selectedDate,
        next.startTime,
        next.breakStartTime,
        next.breakEndTime,
        next.endTime
      );
      if (result.success) {
        const labels = {
          startTime:      'Started work',
          breakStartTime: 'Break started',
          breakEndTime:   'Break ended',
          endTime:        'Finished work'
        };
        setSuccessMessage(`${labels[field]} at ${hhmm}`);
        setTimeout(() => setSuccessMessage(''), 2500);
        // Mirror the break window into the events log once it's complete.
        if (field === 'breakEndTime') {
          await syncBreakAsEvent(next.breakStartTime, next.breakEndTime);
        }
        await loadTimeLogs();
        await loadEvents();
      } else {
        // Roll back the optimistic state if the save failed.
        setTimeLog(timeLog);
        setValidationErrors({ general: result.message || result.error || 'Failed to save' });
      }
    } catch (error) {
      setTimeLog(timeLog);
      console.error('Error stamping time:', error);
      setValidationErrors({ general: 'Could not save: ' + error.message });
    } finally {
      setLoading(false);
    }
  };

  // Are we viewing today's log? Buttons are only meaningful for today —
  // there's no point pretending to "start work" two days ago. Use the
  // office-zone "today" so this matches what the backend stamps under;
  // otherwise UK users (who default to UTC) see the buttons gated for
  // hours of every day when the office (IST) is already on the next date.
  const isToday = selectedDate === getOfficeDate();

  const handleEdit = (logId) => {
    const log = timeLogs.find(l => l.id === logId);
    if (log) {
      setEditingId(logId);
      setEditValues({
        startTime:      trimSeconds(log.startTime),
        breakStartTime: trimSeconds(log.breakStartTime),
        breakEndTime:   trimSeconds(log.breakEndTime),
        endTime:        trimSeconds(log.endTime)
      });
    }
  };

  const handleSaveEdit = async (logId) => {
    const errors = validateTimes(editValues);

    if (Object.keys(errors).length > 0) {
      setValidationErrors(errors);
      return;
    }

    try {
      setLoading(true);
      const result = await window.electron.updateTimeLog(logId, editValues);

      if (result.success) {
        setSuccessMessage('Time log updated successfully!');
        setEditingId(null);
        setEditValues({});
        setTimeout(() => setSuccessMessage(''), 3000);
        // Keep the events log in sync with the edited break window so the
        // graph and Daily Activity Log don't get out of step.
        await syncBreakAsEvent(editValues.breakStartTime, editValues.breakEndTime);
        await loadTimeLogs();
        await loadEvents();
      } else {
        setValidationErrors({ general: result.message || result.error || 'Failed to update time log' });
      }
    } catch (error) {
      console.error('Error updating time log:', error);
      setValidationErrors({ general: 'Failed to update time log: ' + error.message });
    } finally {
      setLoading(false);
    }
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditValues({});
    setValidationErrors({});
  };

  const handleDelete = async (logId) => {
    try {
      setLoading(true);
      const result = await window.electron.deleteTimeLog(logId);

      if (result.success) {
        setSuccessMessage('Time log deleted successfully!');
        setShowDeleteConfirm(null);
        setTimeout(() => setSuccessMessage(''), 3000);
        await loadTimeLogs();
      }
    } catch (error) {
      console.error('Error deleting time log:', error);
      setValidationErrors({ general: 'Failed to delete time log' });
    } finally {
      setLoading(false);
    }
  };

  // Marker used to identify auto-created break events so we can replace them
  // on subsequent saves without disturbing the user's manually-logged events.
  const AUTO_BREAK_MARKER = '[auto-break]';

  // Keep the events log in sync with whatever break time the user has in the
  // Time Logging form. Called after every save / update / sign-in flow.
  //   - If the user has a break: delete any old auto-break event for this day,
  //     create a fresh one tagged with the marker.
  //   - If the user cleared the break: delete the old auto-break event so the
  //     graph doesn't keep showing a stale gap.
  // Other events (manually logged meetings, calls, etc.) are untouched.
  const syncBreakAsEvent = async (breakStart, breakEnd) => {
    try {
      const existing = await window.electron.getEvents(user.id, selectedDate);
      const list = (existing && existing.success && Array.isArray(existing.data)) ? existing.data : [];
      const previousAutoBreaks = list.filter(e =>
        (e.notes || '').startsWith(AUTO_BREAK_MARKER) ||
        // Older auto-breaks may not have the marker — fall back to type+time match
        (e.activity_type === 'break' && (e.notes || '').includes('recorded from Time Logging'))
      );

      // Remove the previous auto-break(s) — there should usually be just one
      for (const ev of previousAutoBreaks) {
        try { await window.electron.deleteEvent(ev.id); } catch (e) { /* swallow */ }
      }

      // Create a fresh auto-break event if the user actually has a break
      if (breakStart && breakEnd) {
        const notes = `${AUTO_BREAK_MARKER} [end=${breakEnd}] Break recorded from Time Logging`;
        await window.electron.createEvent(user.id, selectedDate, breakStart, 'break', notes);
      }
    } catch (err) {
      // Non-fatal — auto-break sync failure shouldn't block the main save
      console.warn('[TimeLog] Failed to sync break-as-event:', err);
    }
  };

  // Event logging functions
  const loadEvents = async () => {
    try {
      const result = await window.electron.getEvents(user.id, selectedDate);
      if (result.success) {
        setEvents(result.data || []);
      }
    } catch (error) {
      console.error('Error loading events:', error);
    }
  };

  const handleAddEvent = () => {
    if (!eventForm.time) {
      setValidationErrors({ event: 'Please select a time for the event' });
      return;
    }

    setValidationErrors({});
    setShowEventModal(false);
    setEventForm({ time: '', activityType: 'meeting', notes: '' });
  };

  const handleSaveEvent = async () => {
    if (!eventForm.time) {
      setValidationErrors({ event: 'Please select a start time for the event' });
      return;
    }
    if (eventForm.endTime && eventForm.endTime <= eventForm.time) {
      setValidationErrors({ event: 'End time must be after start time' });
      return;
    }

    try {
      setLoading(true);
      // Embed end time in notes as a structured prefix so it persists even
      // if the backend schema doesn't have a dedicated end_time column.
      // Format: "[end=HH:MM] user notes here"
      const notesWithEnd = eventForm.endTime
        ? `[end=${eventForm.endTime}] ${eventForm.notes || ''}`.trim()
        : (eventForm.notes || '');

      const result = await window.electron.createEvent(
        user.id,
        selectedDate,
        eventForm.time,
        eventForm.activityType,
        notesWithEnd
      );

      if (result.success) {
        setSuccessMessage('Event logged successfully!');
        setTimeout(() => setSuccessMessage(''), 3000);
        setEventForm({ time: '', endTime: '', activityType: 'admin_work', notes: '' });
        setShowEventModal(false);
        await loadEvents();
      }
    } catch (error) {
      console.error('Error saving event:', error);
      setValidationErrors({ event: 'Failed to save event' });
    } finally {
      setLoading(false);
    }
  };

  // Parse an event's notes to extract the optional end-time prefix.
  // Returns { endTime, cleanNotes } where cleanNotes is the notes without the prefix.
  const parseEventNotes = (rawNotes) => {
    if (!rawNotes) return { endTime: null, cleanNotes: '' };
    const m = rawNotes.match(/^\[end=(\d{2}:\d{2})\]\s*(.*)$/);
    if (m) return { endTime: m[1], cleanNotes: m[2] };
    return { endTime: null, cleanNotes: rawNotes };
  };

  const handleDeleteEvent = async (eventId) => {
    try {
      setLoading(true);
      const result = await window.electron.deleteEvent(eventId);

      if (result.success) {
        setSuccessMessage('Event deleted successfully!');
        setTimeout(() => setSuccessMessage(''), 3000);
        await loadEvents();
      }
    } catch (error) {
      console.error('Error deleting event:', error);
      setValidationErrors({ event: 'Failed to delete event' });
    } finally {
      setLoading(false);
    }
  };

  // Format a Date as YYYY-MM-DD (local time, no timezone shift)
  const isoDate = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  };

  // Open the graph modal for 'day' (current selectedDate), 'week' (last 7 days),
  // 'month' (last 30 days), or 'compare' (last 2 weeks side-by-side).
  // For multi-day ranges we fetch events from the backend in one call.
  const openGraphRange = async (range) => {
    setGraphRange(range);
    if (range === 'day') {
      setRangeEvents([]);
      setShowGraphModal(true);
      return;
    }

    try {
      setRangeLoading(true);
      const today = new Date();
      const daysBack = range === 'week' ? 6 : range === 'month' ? 29 : 13; // 'compare' = 14 days
      const start = new Date();
      start.setDate(today.getDate() - daysBack);

      const result = await window.electron.getEventsByRange(
        user.id,
        isoDate(start),
        isoDate(today)
      );
      const allEvents = result?.success ? (result.data || []) : [];

      if (range === 'compare') {
        // Split into "this week" (days 1-7 ago) and "last week" (days 8-14 ago)
        const weekBoundary = new Date();
        weekBoundary.setDate(today.getDate() - 6);
        const boundaryStr = isoDate(weekBoundary);

        const thisWeek = allEvents.filter((e) => e.date >= boundaryStr);
        const lastWeek = allEvents.filter((e) => e.date < boundaryStr);
        setCompareEvents({ thisWeek, lastWeek });
        setRangeEvents([]);
      } else {
        setRangeEvents(allEvents);
        setCompareEvents({ thisWeek: [], lastWeek: [] });
      }
      setShowGraphModal(true);
    } catch (error) {
      console.error('Error loading range events:', error);
      setRangeEvents([]);
      setCompareEvents({ thisWeek: [], lastWeek: [] });
      setShowGraphModal(true);
    } finally {
      setRangeLoading(false);
    }
  };

  // Aggregate minutes per activity type from a list of events
  const aggregateEvents = (eventList) => {
    const totals = {};
    eventList.forEach((ev) => {
      const typeId = ev.activityType || ev.activity_type;
      const { endTime } = parseEventNotes(ev.notes);
      if (!endTime) return;
      const [sh, sm] = (ev.time || '00:00').split(':').map(Number);
      const [eh, em] = endTime.split(':').map(Number);
      const mins = Math.max(0, (eh * 60 + em) - (sh * 60 + sm));
      totals[typeId] = (totals[typeId] || 0) + mins;
    });
    return totals;
  };

  // v4.3: ref to the Bar chart instance so we can grab a PNG snapshot for PDF
  // export. react-chartjs-2 v4 supports ref forwarding; the ref points at the
  // underlying Chart.js instance which exposes `toBase64Image()`.
  const chartRef = useRef(null);

  // Build a pdfMake doc with the chart image + breakdown rows, then trigger
  // download. Replaces handlePrintGraph (window.print() came up blank in
  // Electron because the print stylesheet hides the renderer chrome and the
  // canvas didn't survive the layout transition).
  const handleExportGraphPdf = async () => {
    try {
      const chart = chartRef.current;
      if (!chart || typeof chart.toBase64Image !== 'function') {
        window.toast?.error?.('Chart not ready — open the graph and try again.');
        return;
      }
      const imgDataUrl = chart.toBase64Image('image/png', 1.0);

      const titleByRange = {
        day:     `Activity — ${selectedDate}`,
        week:    'Activity — Last 7 Days',
        month:   'Activity — Last 30 Days',
        compare: 'Activity — This Week vs Last Week'
      };
      const docTitle = titleByRange[graphRange] || 'Activity Report';

      // Build a small breakdown table from whatever's currently powering the
      // chart. Reuses the totals computed for the on-screen breakdown.
      const isCompare = graphRange === 'compare';
      const tableHeader = isCompare
        ? [{ text: 'Activity', bold: true }, { text: 'This Week (h)', bold: true, alignment: 'right' }, { text: 'Last Week (h)', bold: true, alignment: 'right' }]
        : [{ text: 'Activity', bold: true }, { text: 'Hours', bold: true, alignment: 'right' }, { text: '% of Total', bold: true, alignment: 'right' }];

      // sorted (from the same scope that renders the on-screen table)
      // isn't in this closure — we re-derive it here from the underlying
      // state so the PDF always shows the same numbers as the modal.
      const sourceEvents = (graphRange === 'day') ? events : rangeEvents;
      let pdfRows = [];
      if (isCompare) {
        const types = new Set([
          ...Object.keys(compareEvents.thisWeek || {}),
          ...Object.keys(compareEvents.lastWeek || {})
        ]);
        for (const typeId of types) {
          const label = (activityTypes.find(t => t.id === typeId)?.label) || typeId;
          const thisH = ((compareEvents.thisWeek?.[typeId] || 0) / 60).toFixed(2);
          const lastH = ((compareEvents.lastWeek?.[typeId] || 0) / 60).toFixed(2);
          pdfRows.push([label, { text: thisH, alignment: 'right' }, { text: lastH, alignment: 'right' }]);
        }
      } else {
        const totals = sumEventMinutesByType(sourceEvents);
        const totalMins = Object.values(totals).reduce((a, b) => a + b, 0) || 1;
        const sortedEntries = Object.entries(totals).sort((a, b) => b[1] - a[1]);
        for (const [typeId, mins] of sortedEntries) {
          const label = (activityTypes.find(t => t.id === typeId)?.label) || typeId;
          pdfRows.push([
            label,
            { text: (mins / 60).toFixed(2), alignment: 'right' },
            { text: ((mins / totalMins) * 100).toFixed(1) + '%', alignment: 'right' }
          ]);
        }
      }
      if (pdfRows.length === 0) pdfRows = [[{ text: 'No data', colSpan: tableHeader.length, alignment: 'center', italics: true }]];

      const doc = {
        pageSize: 'A4',
        pageMargins: [40, 50, 40, 50],
        content: [
          { text: 'TaskTango', fontSize: 9, color: '#94a3b8' },
          { text: docTitle, fontSize: 18, bold: true, color: '#1e3a8a', margin: [0, 4, 0, 12] },
          { text: `Employee: ${user?.fullName || ''}`, fontSize: 10, color: '#475569', margin: [0, 0, 0, 4] },
          { text: `Generated: ${getOfficeDate()} ${getOfficeHHMM()}`, fontSize: 10, color: '#475569', margin: [0, 0, 0, 14] },
          { image: imgDataUrl, width: 515 },
          { text: 'Breakdown', fontSize: 13, bold: true, color: '#1e3a8a', margin: [0, 20, 0, 6] },
          {
            table: {
              widths: isCompare ? ['*', 'auto', 'auto'] : ['*', 'auto', 'auto'],
              body: [tableHeader, ...pdfRows]
            },
            layout: 'lightHorizontalLines'
          }
        ],
        defaultStyle: { fontSize: 10, color: '#1a202c' }
      };

      const safeRange = (graphRange || 'day').replace(/[^a-z0-9]/gi, '_');
      const result = await generatePdf(doc, `TaskTango_Activity_${safeRange}_${selectedDate}.pdf`);
      if (result?.success) {
        window.toast?.success?.('PDF downloaded.');
      } else {
        window.toast?.error?.('Could not generate PDF: ' + (result?.error || 'unknown error'));
      }
    } catch (err) {
      console.error('[EXPORT-PDF] failed:', err);
      window.toast?.error?.('Could not generate PDF: ' + (err?.message || err));
    }
  };

  // Sum event minutes per activity type — extracted so the PDF can reuse
  // the same aggregation the on-screen breakdown uses.
  const sumEventMinutesByType = (eventList) => {
    const totals = {};
    if (!Array.isArray(eventList)) return totals;
    for (const ev of eventList) {
      const start = (ev.time || '').slice(0, 5);
      const end   = (ev.endTime || '').slice(0, 5);
      if (!start || !end) continue;
      const [sh, sm] = start.split(':').map(Number);
      const [eh, em] = end.split(':').map(Number);
      const mins = (eh * 60 + em) - (sh * 60 + sm);
      if (mins <= 0) continue;
      const typeId = ev.activityType || 'unknown';
      totals[typeId] = (totals[typeId] || 0) + mins;
    }
    return totals;
  };

  // v4.2: events of type 'break' contribute to total break time so people
  // who take multiple breaks during the day see them all reflected here.
  const eventBreakMinutes = sumBreakEventMinutes(events);
  const durations = calculateDurations(timeLog, eventBreakMinutes);
  const status = getCurrentStatus(timeLog);

  return (
    <div className="timelogging-container">
      <div className="timelogging-header">
        <h2>Time Logging</h2>
        <p>Track your daily work hours and breaks</p>
      </div>

      {successMessage && (
        <div className="success-message">
          <span>✓ {successMessage}</span>
        </div>
      )}

      {validationErrors.general && (
        <div className="error-message">
          <span>✗ {validationErrors.general}</span>
        </div>
      )}

      <div className="timelogging-content">
        {/* Date Picker Section */}
        <div className="date-picker-section">
          <label htmlFor="date-picker">Select Date:</label>
          <input
            id="date-picker"
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            max={getOfficeDate()}
            className="date-picker"
          />
          <button
            className="btn-today"
            onClick={() => setSelectedDate(getOfficeDate())}
          >
            Today
          </button>
        </div>

        {/* v4.1: button-based time logging — no manual typing. The four
            buttons map to the four columns of the time_logs row; each click
            stamps the current local time and immediately UPSERTs the row.
            Only enabled when viewing today (you can't "start work" yesterday). */}
        <div className="time-input-form">
          <div className="form-section">
            <h3>Log Your Time</h3>
            {validationErrors.general && (
              <div className="error-message" style={{ marginBottom: '12px' }}>
                {validationErrors.general}
              </div>
            )}
            {!isToday && (
              <p style={{ color: '#f3f4f6', opacity: 0.85, fontSize: 13, margin: '0 0 12px' }}>
                Viewing a past date — the action buttons are only available for today.
                Use the history list below to inspect or (if admin) correct the row.
              </p>
            )}
            {/* v4.3: Start / End times come exclusively from the Attendance
                page (Sign In / Sign Out). They're shown here for context as
                read-only pills so the user can confirm their day window. The
                only actions on this page are the two break buttons — anything
                else is a single source-of-truth violation. */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 12 }}>
              <div style={{
                flex: '1 1 220px',
                padding: '10px 14px', borderRadius: 10,
                background: timeLog.startTime ? 'rgba(16,185,129,0.15)' : 'rgba(255,255,255,0.05)',
                border: `1px solid ${timeLog.startTime ? '#10b981' : 'rgba(255,255,255,0.1)'}`,
                display: 'flex', flexDirection: 'column', gap: 2
              }}>
                <span style={{ fontSize: 11, opacity: 0.75, textTransform: 'uppercase', letterSpacing: 0.5 }}>▶ Sign In (from Attendance)</span>
                <span style={{ fontSize: 17, fontWeight: 700, fontFamily: 'monospace' }}>
                  {timeLog.startTime || '—'}
                </span>
              </div>
              <div style={{
                flex: '1 1 220px',
                padding: '10px 14px', borderRadius: 10,
                background: timeLog.endTime ? 'rgba(239,68,68,0.15)' : 'rgba(255,255,255,0.05)',
                border: `1px solid ${timeLog.endTime ? '#ef4444' : 'rgba(255,255,255,0.1)'}`,
                display: 'flex', flexDirection: 'column', gap: 2
              }}>
                <span style={{ fontSize: 11, opacity: 0.75, textTransform: 'uppercase', letterSpacing: 0.5 }}>■ Sign Out (from Attendance)</span>
                <span style={{ fontSize: 17, fontWeight: 700, fontFamily: 'monospace' }}>
                  {timeLog.endTime || '—'}
                </span>
              </div>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              <button
                type="button"
                onClick={() => stampNow('breakStartTime')}
                disabled={!isToday || loading || !timeLog.startTime || !!timeLog.breakStartTime || !!timeLog.endTime}
                title={timeLog.breakStartTime ? `Break started at ${timeLog.breakStartTime}` : (!timeLog.startTime ? 'Sign in on the Attendance page first' : 'Stamp your break start time')}
                style={{
                  flex: '1 1 220px', minHeight: 70,
                  padding: '14px 18px', fontSize: 15, fontWeight: 700,
                  borderRadius: 10, border: 'none', cursor: (!isToday || loading || !timeLog.startTime || !!timeLog.breakStartTime || !!timeLog.endTime) ? 'not-allowed' : 'pointer',
                  background: timeLog.breakStartTime ? '#1f2937' : 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
                  color: '#fff', opacity: (!isToday || loading || !timeLog.startTime || !!timeLog.breakStartTime || !!timeLog.endTime) ? 0.6 : 1,
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4
                }}
              >
                <span>☕ Start Break</span>
                {timeLog.breakStartTime && <span style={{ fontSize: 12, fontWeight: 500, opacity: 0.85 }}>at {timeLog.breakStartTime}</span>}
              </button>

              <button
                type="button"
                onClick={() => stampNow('breakEndTime')}
                disabled={!isToday || loading || !timeLog.breakStartTime || !!timeLog.breakEndTime || !!timeLog.endTime}
                title={timeLog.breakEndTime ? `Break ended at ${timeLog.breakEndTime}` : 'Stamp your break end time'}
                style={{
                  flex: '1 1 220px', minHeight: 70,
                  padding: '14px 18px', fontSize: 15, fontWeight: 700,
                  borderRadius: 10, border: 'none', cursor: (!isToday || loading || !timeLog.breakStartTime || !!timeLog.breakEndTime || !!timeLog.endTime) ? 'not-allowed' : 'pointer',
                  background: timeLog.breakEndTime ? '#1f2937' : 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
                  color: '#fff', opacity: (!isToday || loading || !timeLog.breakStartTime || !!timeLog.breakEndTime || !!timeLog.endTime) ? 0.6 : 1,
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4
                }}
              >
                <span>◀ End Break</span>
                {timeLog.breakEndTime && <span style={{ fontSize: 12, fontWeight: 500, opacity: 0.85 }}>at {timeLog.breakEndTime}</span>}
              </button>
            </div>
            {isToday && !timeLog.startTime && (
              <p style={{ marginTop: 12, marginBottom: 0, fontSize: 12, color: '#f59e0b' }}>
                ⓘ Sign in on the <strong>Attendance</strong> page to start your day — the start time will appear here automatically.
              </p>
            )}
          </div>

          {/* Calculations Display */}
          <div className="calculations-section">
            <div className="calc-card">
              <div className="calc-label">Total Working Hours</div>
              <div className="calc-value">{durations.workingHours}h</div>
            </div>
            <div className="calc-card">
              <div className="calc-label">Total Break Duration</div>
              <div className="calc-value">{durations.breakDuration}h</div>
            </div>
            <div className="calc-card highlight">
              <div className="calc-label">Net Working Hours</div>
              <div className="calc-value">{durations.netWorkingHours}h</div>
            </div>
            <div className={`calc-card status-${status.toLowerCase().replace(/\s+/g, '-')}`}>
              <div className="calc-label">Current Status</div>
              <div className="calc-value">{status}</div>
            </div>
          </div>

          <div className="form-actions">
            <button
              type="button"
              className="btn-add-event"
              onClick={() => setShowEventModal(true)}
              disabled={loading}
            >
              + Add Event
            </button>
          </div>
        </div>

        {/* Activity Graph Modal */}
        {showGraphModal && (() => {
          // Decide which set of events powers this view.
          //   'day'   → just the events for `selectedDate` (already in `events`)
          //   'week'  → last 7 days  (pre-loaded into `rangeEvents`)
          //   'month' → last 30 days (pre-loaded into `rangeEvents`)
          const isCompareView = graphRange === 'compare';
          const isRangeView = graphRange !== 'day' && !isCompareView;
          const sourceEvents = isCompareView
            ? [...compareEvents.thisWeek, ...compareEvents.lastWeek]
            : isRangeView ? rangeEvents : events;

          // How many distinct days are represented (for averages in week/month view)
          const distinctDates = new Set(sourceEvents.map((e) => e.date)).size || 1;

          // Aggregate minutes per activity type from events with end times.
          const totals = isCompareView
            ? (() => {
                // For compare: merge both weeks for the "sorted by total" ordering
                const t = aggregateEvents(compareEvents.thisWeek);
                const l = aggregateEvents(compareEvents.lastWeek);
                const merged = { ...t };
                Object.keys(l).forEach((k) => { merged[k] = (merged[k] || 0) + l[k]; });
                return merged;
              })()
            : aggregateEvents(sourceEvents);
          const thisWeekTotals = isCompareView ? aggregateEvents(compareEvents.thisWeek) : {};
          const lastWeekTotals = isCompareView ? aggregateEvents(compareEvents.lastWeek) : {};

          // Day-level summary (only shown in day view, irrelevant for ranges)
          const minsBetween = (a, b) => {
            if (!a || !b) return null;
            const [ah, am] = a.split(':').map(Number);
            const [bh, bm] = b.split(':').map(Number);
            const diff = (bh * 60 + bm) - (ah * 60 + am);
            return diff > 0 ? diff : null;
          };
          const dayMins   = !isRangeView ? minsBetween(timeLog.startTime, timeLog.endTime) : null;
          const breakMins = !isRangeView ? minsBetween(timeLog.breakStartTime, timeLog.breakEndTime) : null;
          const netMins   = dayMins != null ? dayMins - (breakMins || 0) : null;
          const loggedMins = Object.values(totals).reduce((a, b) => a + b, 0);
          const untrackedMins = netMins != null ? Math.max(0, netMins - loggedMins) : null;
          const fmt = (m) => m == null ? '—' : `${(m / 60).toFixed(2)}h`;

          // Range header label
          const today = new Date();
          const todayStr = isoDate(today);
          const weekAgo = new Date(); weekAgo.setDate(today.getDate() - 6);
          const twoWeeksAgo = new Date(); twoWeeksAgo.setDate(today.getDate() - 13);
          const monthAgo = new Date(); monthAgo.setDate(today.getDate() - 29);

          const rangeLabel =
            graphRange === 'day'     ? `Day · ${selectedDate}` :
            graphRange === 'week'    ? `Last Week · ${isoDate(weekAgo)} → ${todayStr}` :
            graphRange === 'month'   ? `Last Month · ${isoDate(monthAgo)} → ${todayStr}` :
            graphRange === 'compare' ? `Two-Week Comparison · ${isoDate(twoWeeksAgo)} → ${todayStr}` :
                                       '';

          // Distinct color per activity type (matches the activity list order)
          const colorMap = {
            admin_work:        '#3b82f6',
            file_work:         '#14b8a6',
            break:             '#f59e0b',
            calls:             '#10b981',
            compliance:        '#8b5cf6',
            internal_meeting:  '#06b6d4',
            external_meeting:  '#0ea5e9',
            training_given:    '#ec4899',
            training_received: '#f43f5e',
            social_media:      '#a855f7',
            asset_finance:     '#22c55e',
            unforced_break:    '#ef4444'
          };

          // Sort by total time descending
          const sorted = Object.entries(totals).sort((a, b) => b[1] - a[1]);
          const labels = sorted.map(([typeId]) => {
            const a = activityTypes.find((t) => t.id === typeId);
            return a ? a.label : typeId;
          });
          const hours = sorted.map(([, mins]) => parseFloat((mins / 60).toFixed(2)));
          const colors = sorted.map(([typeId]) => colorMap[typeId] || '#6b7280');
          const totalHours = (Object.values(totals).reduce((a, b) => a + b, 0) / 60).toFixed(2);

          // Chart data: compare mode uses 2 datasets, otherwise 1
          const data = isCompareView
            ? {
                labels,
                datasets: [
                  {
                    label: `This Week (${isoDate(weekAgo)} → ${todayStr})`,
                    data: sorted.map(([typeId]) => parseFloat(((thisWeekTotals[typeId] || 0) / 60).toFixed(2))),
                    backgroundColor: '#3b82f6',
                    borderColor: '#1d4ed8',
                    borderWidth: 1,
                    borderRadius: 6,
                    maxBarThickness: 30
                  },
                  {
                    label: `Last Week (${isoDate(twoWeeksAgo)} → ${isoDate(new Date(weekAgo.getTime() - 86400000))})`,
                    data: sorted.map(([typeId]) => parseFloat(((lastWeekTotals[typeId] || 0) / 60).toFixed(2))),
                    backgroundColor: '#f97316',
                    borderColor: '#c2410c',
                    borderWidth: 1,
                    borderRadius: 6,
                    maxBarThickness: 30
                  }
                ]
              }
            : {
                labels,
                datasets: [
                  {
                    label: 'Hours',
                    data: hours,
                    backgroundColor: colors,
                    borderColor: colors,
                    borderWidth: 1,
                    borderRadius: 6,
                    maxBarThickness: 40
                  }
                ]
              };

          // Custom plugin: draws the hours value at the end of each bar.
          // Uses a contrasting color (white on dark bars, dark on light areas).
          const valueLabelsPlugin = {
            id: 'valueLabels',
            afterDatasetsDraw(chart) {
              const { ctx } = chart;
              ctx.save();
              ctx.font = 'bold 12px sans-serif';
              ctx.textBaseline = 'middle';

              // Loop over EVERY dataset so we label all bars (handles compare mode too)
              chart.data.datasets.forEach((dataset, dsIdx) => {
                const meta = chart.getDatasetMeta(dsIdx);
                meta.data.forEach((bar, i) => {
                  const value = dataset.data[i];
                  if (!value && value !== 0) return;
                  const label = `${value.toFixed(2)}h`;
                  const { y } = bar.tooltipPosition();
                  const barWidth = bar.x - chart.scales.x.left;
                  const textWidth = ctx.measureText(label).width;
                  const insideBar = barWidth > textWidth + 16;

                  let drawX, align;
                  if (insideBar) {
                    drawX = bar.x - 6;
                    align = 'right';
                  } else {
                    drawX = bar.x + 6;
                    align = 'left';
                  }

                  ctx.textAlign = align;
                  // White fill with dark outline — readable on any bar color or dark bg
                  ctx.lineWidth = 3;
                  ctx.strokeStyle = '#0f172a';
                  ctx.strokeText(label, drawX, y);
                  ctx.fillStyle = '#ffffff';
                  ctx.fillText(label, drawX, y);
                });
              });
              ctx.restore();
            }
          };

          const options = {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            // Leave room on the right for value labels that overflow short bars
            layout: { padding: { right: 50, top: 8, bottom: 8 } },
            plugins: {
              legend: {
                display: isCompareView, // only show legend in compare mode (where we have 2 datasets)
                position: 'top',
                labels: {
                  color: '#ffffff',
                  font: { size: 13, weight: '600' },
                  boxWidth: 18,
                  padding: 14
                }
              },
              title: {
                display: true,
                text: `${rangeLabel} — Total: ${totalHours}h`,
                font: { size: 17, weight: 'bold' },
                color: '#ffffff',
                padding: { bottom: 16 }
              },
              tooltip: {
                backgroundColor: '#f1f5f9',
                titleColor: '#0f172a',
                bodyColor: '#0f172a',
                titleFont: { weight: 'bold', size: 13 },
                bodyFont: { size: 13 },
                padding: 10,
                callbacks: {
                  label: (ctx) => `${ctx.parsed.x.toFixed(2)} hours`
                }
              }
            },
            scales: {
              x: {
                beginAtZero: true,
                title: {
                  display: true,
                  text: 'Hours',
                  color: '#ffffff',
                  font: { size: 13, weight: 'bold' }
                },
                ticks: {
                  color: '#ffffff',
                  font: { size: 12, weight: '600' }
                },
                grid: { color: 'rgba(255, 255, 255, 0.15)', lineWidth: 1 }
              },
              y: {
                ticks: {
                  color: '#ffffff',
                  font: { size: 13, weight: '600' }
                },
                grid: { display: false }
              }
            }
          };

          return (
            <div className="modal-overlay" onClick={() => setShowGraphModal(false)}>
              <div
                className="modal-content"
                onClick={(e) => e.stopPropagation()}
                style={{ maxWidth: '900px', width: '95%', background: '#0f172a', color: '#ffffff' }}
              >
                <div className="modal-header" style={{ borderBottom: '1px solid #334155' }}>
                  <h3 style={{ color: '#ffffff' }}>
                    📊 {graphRange === 'day' ? 'Daily' : graphRange === 'week' ? 'Weekly' : 'Monthly'} Activity Breakdown
                  </h3>
                  <button
                    className="modal-close"
                    onClick={() => setShowGraphModal(false)}
                    style={{ color: '#ffffff' }}
                  >
                    ×
                  </button>
                </div>

                <div className="modal-body" style={{ padding: '24px' }}>
                  {/* Day summary card — only shown when viewing a single day */}
                  {!isRangeView && (dayMins != null || breakMins != null || loggedMins > 0) && (
                    <div style={{
                      background: 'linear-gradient(135deg, #1e293b 0%, #334155 100%)',
                      color: '#f1f5f9',
                      padding: '16px 20px',
                      borderRadius: '10px',
                      marginBottom: '20px',
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                      gap: '14px'
                    }}>
                      <div>
                        <div style={{ fontSize: '11px', textTransform: 'uppercase', color: '#94a3b8', fontWeight: 600, marginBottom: '4px' }}>
                          Day Start
                        </div>
                        <div style={{ fontSize: '18px', fontWeight: 700, fontFamily: 'monospace' }}>
                          {timeLog.startTime || '—'}
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: '11px', textTransform: 'uppercase', color: '#94a3b8', fontWeight: 600, marginBottom: '4px' }}>
                          Day End
                        </div>
                        <div style={{ fontSize: '18px', fontWeight: 700, fontFamily: 'monospace' }}>
                          {timeLog.endTime || '—'}
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: '11px', textTransform: 'uppercase', color: '#94a3b8', fontWeight: 600, marginBottom: '4px' }}>
                          Total Day
                        </div>
                        <div style={{ fontSize: '18px', fontWeight: 700, color: '#60a5fa' }}>
                          {fmt(dayMins)}
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: '11px', textTransform: 'uppercase', color: '#94a3b8', fontWeight: 600, marginBottom: '4px' }}>
                          Break Time
                        </div>
                        <div style={{ fontSize: '18px', fontWeight: 700, color: '#fbbf24' }}>
                          {fmt(breakMins)}
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: '11px', textTransform: 'uppercase', color: '#94a3b8', fontWeight: 600, marginBottom: '4px' }}>
                          Net Working
                        </div>
                        <div style={{ fontSize: '18px', fontWeight: 700, color: '#34d399' }}>
                          {fmt(netMins)}
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: '11px', textTransform: 'uppercase', color: '#94a3b8', fontWeight: 600, marginBottom: '4px' }}>
                          Activities Logged
                        </div>
                        <div style={{ fontSize: '18px', fontWeight: 700, color: '#a78bfa' }}>
                          {fmt(loggedMins)}
                        </div>
                      </div>
                      {untrackedMins != null && (
                        <div>
                          <div style={{ fontSize: '11px', textTransform: 'uppercase', color: '#94a3b8', fontWeight: 600, marginBottom: '4px' }}>
                            Untracked
                          </div>
                          <div style={{ fontSize: '18px', fontWeight: 700, color: untrackedMins > 0 ? '#f87171' : '#34d399' }}>
                            {fmt(untrackedMins)}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Compare summary card — only shown in 2-week comparison view */}
                  {isCompareView && (() => {
                    const thisWeekMins = Object.values(thisWeekTotals).reduce((a, b) => a + b, 0);
                    const lastWeekMins = Object.values(lastWeekTotals).reduce((a, b) => a + b, 0);
                    const diff = thisWeekMins - lastWeekMins;
                    const pctChange = lastWeekMins > 0
                      ? Math.round((diff / lastWeekMins) * 100)
                      : null;
                    return (
                      <div style={{
                        background: 'linear-gradient(135deg, #1e293b 0%, #334155 100%)',
                        color: '#f1f5f9',
                        padding: '16px 20px',
                        borderRadius: '10px',
                        marginBottom: '20px',
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                        gap: '14px'
                      }}>
                        <div>
                          <div style={{ fontSize: '11px', textTransform: 'uppercase', color: '#94a3b8', fontWeight: 600, marginBottom: '4px' }}>
                            🟦 This Week
                          </div>
                          <div style={{ fontSize: '18px', fontWeight: 700, color: '#60a5fa' }}>
                            {fmt(thisWeekMins)}
                          </div>
                          <div style={{ fontSize: '12px', color: '#cbd5e1' }}>
                            {compareEvents.thisWeek.length} activities
                          </div>
                        </div>
                        <div>
                          <div style={{ fontSize: '11px', textTransform: 'uppercase', color: '#94a3b8', fontWeight: 600, marginBottom: '4px' }}>
                            🟧 Last Week
                          </div>
                          <div style={{ fontSize: '18px', fontWeight: 700, color: '#fb923c' }}>
                            {fmt(lastWeekMins)}
                          </div>
                          <div style={{ fontSize: '12px', color: '#cbd5e1' }}>
                            {compareEvents.lastWeek.length} activities
                          </div>
                        </div>
                        <div>
                          <div style={{ fontSize: '11px', textTransform: 'uppercase', color: '#94a3b8', fontWeight: 600, marginBottom: '4px' }}>
                            Difference
                          </div>
                          <div style={{ fontSize: '18px', fontWeight: 700, color: diff >= 0 ? '#34d399' : '#f87171' }}>
                            {diff >= 0 ? '+' : ''}{fmt(Math.abs(diff))}
                          </div>
                          {pctChange != null && (
                            <div style={{ fontSize: '12px', color: '#cbd5e1' }}>
                              {pctChange >= 0 ? '+' : ''}{pctChange}% vs last week
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })()}

                  {/* Range summary card — only shown when viewing a week or month */}
                  {isRangeView && (
                    <div style={{
                      background: 'linear-gradient(135deg, #1e293b 0%, #334155 100%)',
                      color: '#f1f5f9',
                      padding: '16px 20px',
                      borderRadius: '10px',
                      marginBottom: '20px',
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                      gap: '14px'
                    }}>
                      <div>
                        <div style={{ fontSize: '11px', textTransform: 'uppercase', color: '#94a3b8', fontWeight: 600, marginBottom: '4px' }}>
                          Range
                        </div>
                        <div style={{ fontSize: '14px', fontWeight: 700 }}>
                          {graphRange === 'week' ? 'Last 7 days' : 'Last 30 days'}
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: '11px', textTransform: 'uppercase', color: '#94a3b8', fontWeight: 600, marginBottom: '4px' }}>
                          Days With Activity
                        </div>
                        <div style={{ fontSize: '18px', fontWeight: 700, color: '#60a5fa' }}>
                          {distinctDates}
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: '11px', textTransform: 'uppercase', color: '#94a3b8', fontWeight: 600, marginBottom: '4px' }}>
                          Activities Logged
                        </div>
                        <div style={{ fontSize: '18px', fontWeight: 700, color: '#a78bfa' }}>
                          {sourceEvents.length}
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: '11px', textTransform: 'uppercase', color: '#94a3b8', fontWeight: 600, marginBottom: '4px' }}>
                          Total Hours
                        </div>
                        <div style={{ fontSize: '18px', fontWeight: 700, color: '#34d399' }}>
                          {fmt(loggedMins)}
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: '11px', textTransform: 'uppercase', color: '#94a3b8', fontWeight: 600, marginBottom: '4px' }}>
                          Avg / Day
                        </div>
                        <div style={{ fontSize: '18px', fontWeight: 700, color: '#fbbf24' }}>
                          {fmt(loggedMins / distinctDates)}
                        </div>
                      </div>
                    </div>
                  )}

                  {sorted.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '40px', color: '#cbd5e1' }}>
                      <p style={{ fontSize: '16px', marginBottom: '8px', color: '#ffffff' }}>
                        No activities with end times yet
                      </p>
                      <p style={{ fontSize: '13px' }}>
                        Add an activity and include a start AND end time to see it in the graph.
                      </p>
                    </div>
                  ) : (
                    <>
                      <div style={{ height: `${Math.max(300, sorted.length * 50)}px` }}>
                        <Bar ref={chartRef} data={data} options={options} plugins={[valueLabelsPlugin]} />
                      </div>

                      {/* Detailed breakdown table below the chart */}
                      <div style={{ marginTop: '24px' }}>
                        <h4 style={{ margin: '0 0 12px 0', color: '#ffffff' }}>Breakdown</h4>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px', color: '#ffffff' }}>
                          <thead>
                            <tr style={{ background: '#1e293b', textAlign: 'left' }}>
                              <th style={{ padding: '10px 12px', color: '#ffffff' }}>Activity</th>
                              {isCompareView ? (
                                <>
                                  <th style={{ padding: '10px 12px', textAlign: 'right', color: '#60a5fa' }}>This Week</th>
                                  <th style={{ padding: '10px 12px', textAlign: 'right', color: '#fb923c' }}>Last Week</th>
                                  <th style={{ padding: '10px 12px', textAlign: 'right', color: '#ffffff' }}>Δ Change</th>
                                </>
                              ) : (
                                <>
                                  <th style={{ padding: '10px 12px', textAlign: 'right', color: '#ffffff' }}>Hours</th>
                                  <th style={{ padding: '10px 12px', textAlign: 'right', color: '#ffffff' }}>
                                    {isRangeView ? '% of Total' : '% of Day'}
                                  </th>
                                </>
                              )}
                            </tr>
                          </thead>
                          <tbody>
                            {sorted.map(([typeId, mins]) => {
                              const a = activityTypes.find((t) => t.id === typeId);
                              const h = (mins / 60).toFixed(2);
                              const pct = ((mins / (totalHours * 60)) * 100).toFixed(1);
                              const tw = (thisWeekTotals[typeId] || 0) / 60;
                              const lw = (lastWeekTotals[typeId] || 0) / 60;
                              const delta = tw - lw;
                              return (
                                <tr key={typeId} style={{ borderBottom: '1px solid #334155' }}>
                                  <td style={{ padding: '10px 12px', color: '#ffffff' }}>
                                    <span style={{
                                      display: 'inline-block',
                                      width: '12px',
                                      height: '12px',
                                      borderRadius: '3px',
                                      background: colorMap[typeId] || '#6b7280',
                                      marginRight: '8px',
                                      verticalAlign: 'middle'
                                    }} />
                                    {a ? a.label : typeId}
                                  </td>
                                  {isCompareView ? (
                                    <>
                                      <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 600, color: '#60a5fa' }}>
                                        {tw.toFixed(2)}h
                                      </td>
                                      <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 600, color: '#fb923c' }}>
                                        {lw.toFixed(2)}h
                                      </td>
                                      <td style={{
                                        padding: '10px 12px',
                                        textAlign: 'right',
                                        fontWeight: 600,
                                        color: delta >= 0 ? '#34d399' : '#f87171'
                                      }}>
                                        {delta >= 0 ? '+' : ''}{delta.toFixed(2)}h
                                      </td>
                                    </>
                                  ) : (
                                    <>
                                      <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 600, color: '#ffffff' }}>
                                        {h}h
                                      </td>
                                      <td style={{ padding: '10px 12px', textAlign: 'right', color: '#cbd5e1' }}>
                                        {pct}%
                                      </td>
                                    </>
                                  )}
                                </tr>
                              );
                            })}
                            <tr style={{ background: '#1e293b', fontWeight: 700 }}>
                              <td style={{ padding: '10px 12px', color: '#ffffff' }}>Total</td>
                              {isCompareView ? (
                                <>
                                  <td style={{ padding: '10px 12px', textAlign: 'right', color: '#60a5fa' }}>
                                    {(Object.values(thisWeekTotals).reduce((a, b) => a + b, 0) / 60).toFixed(2)}h
                                  </td>
                                  <td style={{ padding: '10px 12px', textAlign: 'right', color: '#fb923c' }}>
                                    {(Object.values(lastWeekTotals).reduce((a, b) => a + b, 0) / 60).toFixed(2)}h
                                  </td>
                                  <td style={{ padding: '10px 12px', textAlign: 'right', color: '#ffffff' }}>—</td>
                                </>
                              ) : (
                                <>
                                  <td style={{ padding: '10px 12px', textAlign: 'right', color: '#ffffff' }}>{totalHours}h</td>
                                  <td style={{ padding: '10px 12px', textAlign: 'right', color: '#ffffff' }}>100%</td>
                                </>
                              )}
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </div>

                <div className="modal-footer no-print">
                  <button
                    type="button"
                    onClick={handleExportGraphPdf}
                    style={{
                      padding: '10px 20px',
                      background: 'linear-gradient(135deg, #f97316 0%, #ea580c 100%)',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      fontWeight: 600,
                      fontSize: '14px',
                      cursor: 'pointer'
                    }}
                  >
                    📄 Export to PDF
                  </button>
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={() => setShowGraphModal(false)}
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Event Modal */}
        {showEventModal && (
          <div className="modal-overlay" onClick={() => setShowEventModal(false)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h3>Log a Daily Event</h3>
                <button
                  className="modal-close"
                  onClick={() => {
                    setShowEventModal(false);
                    setEventForm({ time: '', endTime: '', activityType: 'admin_work', notes: '' });
                    setValidationErrors({});
                  }}
                >
                  ×
                </button>
              </div>

              <div className="modal-body">
                {validationErrors.event && (
                  <div className="error-message">
                    <span>✗ {validationErrors.event}</span>
                  </div>
                )}

                <div className="form-group">
                  <label htmlFor="activity-type">Activity Type *</label>
                  <select
                    id="activity-type"
                    value={eventForm.activityType}
                    onChange={(e) =>
                      setEventForm({ ...eventForm, activityType: e.target.value })
                    }
                  >
                    {activityTypes.map((type) => (
                      <option key={type.id} value={type.id}>
                        {type.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-row" style={{ display: 'flex', gap: '12px' }}>
                  <div className="form-group" style={{ flex: 1 }}>
                    <label htmlFor="event-time">Start Time *</label>
                    <input
                      id="event-time"
                      type="text" placeholder="HH:MM" pattern="[0-9]{1,2}:[0-9]{2}" maxLength={5} inputMode="numeric"
                      value={eventForm.time}
                      onChange={(e) => {
                        setEventForm({ ...eventForm, time: e.target.value });
                        if (validationErrors.event) setValidationErrors({});
                      }}
                    />
                  </div>
                  <div className="form-group" style={{ flex: 1 }}>
                    <label htmlFor="event-end-time">End Time</label>
                    <input
                      id="event-end-time"
                      type="text" placeholder="HH:MM" pattern="[0-9]{1,2}:[0-9]{2}" maxLength={5} inputMode="numeric"
                      value={eventForm.endTime}
                      onChange={(e) => setEventForm({ ...eventForm, endTime: e.target.value })}
                    />
                  </div>
                </div>

                {eventForm.time && eventForm.endTime && (
                  <div style={{
                    background: '#ecfdf5',
                    color: '#065f46',
                    padding: '8px 12px',
                    borderRadius: '6px',
                    fontSize: '13px',
                    marginBottom: '12px'
                  }}>
                    ⏱ Duration: {calcEventDuration(eventForm.time, eventForm.endTime) || 'Invalid range'}
                  </div>
                )}

                <div className="form-group">
                  <label htmlFor="event-notes">Notes (Optional)</label>
                  <textarea
                    id="event-notes"
                    value={eventForm.notes}
                    onChange={(e) =>
                      setEventForm({ ...eventForm, notes: e.target.value })
                    }
                    placeholder="What did you work on? Who did you meet with? Any details to remember..."
                    rows="3"
                  />
                </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  className="btn-cancel"
                  onClick={() => {
                    setShowEventModal(false);
                    setEventForm({ time: '', endTime: '', activityType: 'admin_work', notes: '' });
                    setValidationErrors({});
                  }}
                  disabled={loading}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={handleSaveEvent}
                  disabled={loading || !eventForm.time}
                >
                  {loading ? 'Saving...' : 'Save Event'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* History Section */}
        <div className="history-section">
          <h3>Time Log History</h3>

          {timeLogs.length === 0 ? (
            <div className="no-logs">
              <p>No time logs recorded for this date</p>
            </div>
          ) : (
            <div className="logs-list">
              {timeLogs.map((log) => (
                <div key={log.id} className="log-item">
                  {editingId === log.id ? (
                    <div className="edit-form">
                      <div className="edit-fields">
                        <div className="edit-field">
                          <label>Start Time:</label>
                          <input
                            type="text" placeholder="HH:MM" pattern="[0-9]{1,2}:[0-9]{2}" maxLength={5} inputMode="numeric"
                            value={editValues.startTime}
                            onChange={(e) =>
                              setEditValues({ ...editValues, startTime: e.target.value })
                            }
                          />
                        </div>
                        <div className="edit-field">
                          <label>Break Start:</label>
                          <input
                            type="text" placeholder="HH:MM" pattern="[0-9]{1,2}:[0-9]{2}" maxLength={5} inputMode="numeric"
                            value={editValues.breakStartTime}
                            onChange={(e) =>
                              setEditValues({ ...editValues, breakStartTime: e.target.value })
                            }
                          />
                        </div>
                        <div className="edit-field">
                          <label>Break End:</label>
                          <input
                            type="text" placeholder="HH:MM" pattern="[0-9]{1,2}:[0-9]{2}" maxLength={5} inputMode="numeric"
                            value={editValues.breakEndTime}
                            onChange={(e) =>
                              setEditValues({ ...editValues, breakEndTime: e.target.value })
                            }
                          />
                        </div>
                        <div className="edit-field">
                          <label>End Time:</label>
                          <input
                            type="text" placeholder="HH:MM" pattern="[0-9]{1,2}:[0-9]{2}" maxLength={5} inputMode="numeric"
                            value={editValues.endTime}
                            onChange={(e) =>
                              setEditValues({ ...editValues, endTime: e.target.value })
                            }
                          />
                        </div>
                      </div>
                      <div className="edit-actions">
                        <button
                          onClick={() => handleSaveEdit(log.id)}
                          className="btn-save"
                          disabled={loading}
                        >
                          Save
                        </button>
                        <button
                          onClick={handleCancelEdit}
                          className="btn-cancel"
                          disabled={loading}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="log-details">
                        <div className="log-time">
                          <span className="time-label">Start:</span>
                          <span className="time-value">{log.startTime}</span>
                        </div>
                        {log.breakStartTime && log.breakEndTime && (
                          <div className="log-break">
                            <span className="time-label">Break:</span>
                            <span className="time-value">
                              {log.breakStartTime} - {log.breakEndTime}
                            </span>
                          </div>
                        )}
                        <div className="log-time">
                          <span className="time-label">End:</span>
                          <span className="time-value">{log.endTime}</span>
                        </div>
                      </div>

                      <div className="log-stats">
                        {(() => {
                          // History row: only fold in event-break minutes
                          // for the row that matches selectedDate (that's
                          // the only date `events` is loaded for). Other
                          // historical rows render with just the time_logs
                          // window — accurate for what's known on-screen.
                          const rowExtraBreak = log.date === selectedDate ? eventBreakMinutes : 0;
                          const logDurations = calculateDurations({
                            startTime: log.startTime,
                            breakStartTime: log.breakStartTime,
                            breakEndTime: log.breakEndTime,
                            endTime: log.endTime
                          }, rowExtraBreak);
                          return (
                            <>
                              <span className="stat">Working: {logDurations.workingHours}h</span>
                              {log.breakStartTime && (
                                <span className="stat">Break: {logDurations.breakDuration}h</span>
                              )}
                              <span className="stat highlight">
                                Net: {logDurations.netWorkingHours}h
                              </span>
                            </>
                          );
                        })()}
                      </div>

                      {canEdit && (
                        <div className="log-actions">
                          <button
                            onClick={() => handleEdit(log.id)}
                            className="btn-edit"
                            disabled={loading}
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => setShowDeleteConfirm(log.id)}
                            className="btn-delete"
                            disabled={loading}
                          >
                            Delete
                          </button>
                        </div>
                      )}

                      {showDeleteConfirm === log.id && (
                        <div className="delete-confirm">
                          <p>Are you sure you want to delete this log?</p>
                          <div className="confirm-actions">
                            <button
                              onClick={() => handleDelete(log.id)}
                              className="btn-confirm-delete"
                              disabled={loading}
                            >
                              Delete
                            </button>
                            <button
                              onClick={() => setShowDeleteConfirm(null)}
                              className="btn-cancel-delete"
                              disabled={loading}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Events Section */}
        <div className="events-section">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
            <h3 style={{ margin: 0 }}>📅 Daily Activity Log</h3>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => openGraphRange('day')}
                disabled={loading || rangeLoading || events.length === 0}
                style={{
                  padding: '8px 14px',
                  fontSize: '14px',
                  background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  fontWeight: 600,
                  cursor: events.length === 0 ? 'not-allowed' : 'pointer',
                  opacity: events.length === 0 ? 0.5 : 1
                }}
              >
                📊 Day
              </button>
              <button
                type="button"
                onClick={() => openGraphRange('week')}
                disabled={loading || rangeLoading}
                style={{
                  padding: '8px 14px',
                  fontSize: '14px',
                  background: 'linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  fontWeight: 600,
                  cursor: rangeLoading ? 'wait' : 'pointer'
                }}
              >
                {rangeLoading && graphRange === 'week' ? '⏳ Loading…' : '📅 Last Week'}
              </button>
              <button
                type="button"
                onClick={() => openGraphRange('month')}
                disabled={loading || rangeLoading}
                style={{
                  padding: '8px 14px',
                  fontSize: '14px',
                  background: 'linear-gradient(135deg, #059669 0%, #047857 100%)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  fontWeight: 600,
                  cursor: rangeLoading ? 'wait' : 'pointer'
                }}
              >
                {rangeLoading && graphRange === 'month' ? '⏳ Loading…' : '🗓️ Last Month'}
              </button>
              <button
                type="button"
                onClick={() => openGraphRange('compare')}
                disabled={loading || rangeLoading}
                style={{
                  padding: '8px 14px',
                  fontSize: '14px',
                  background: 'linear-gradient(135deg, #f97316 0%, #ea580c 100%)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  fontWeight: 600,
                  cursor: rangeLoading ? 'wait' : 'pointer'
                }}
              >
                {rangeLoading && graphRange === 'compare' ? '⏳ Loading…' : '📊 Compare 2 Weeks'}
              </button>
              <button
                type="button"
                className="btn-add-event"
                onClick={() => setShowEventModal(true)}
                disabled={loading}
                style={{ padding: '8px 14px', fontSize: '14px', flex: 'none', width: 'auto' }}
              >
                + Add Activity
              </button>
            </div>
          </div>

          {/* Daily summary by activity type */}
          {events.length > 0 && (() => {
            const totals = {};
            events.forEach((ev) => {
              const typeId = ev.activityType || ev.activity_type;
              const { endTime } = parseEventNotes(ev.notes);
              if (!endTime) return;
              const [sh, sm] = (ev.time || '00:00').split(':').map(Number);
              const [eh, em] = endTime.split(':').map(Number);
              const mins = Math.max(0, (eh * 60 + em) - (sh * 60 + sm));
              totals[typeId] = (totals[typeId] || 0) + mins;
            });
            const totalMins = Object.values(totals).reduce((a, b) => a + b, 0);
            if (totalMins === 0) return null;
            return (
              <div style={{
                background: '#f3f4f6',
                padding: '12px',
                borderRadius: '8px',
                marginBottom: '12px',
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                gap: '8px'
              }}>
                <div style={{ gridColumn: '1 / -1', fontSize: '12px', fontWeight: 700, color: '#1f2937' }}>
                  TIME BREAKDOWN — TOTAL: {(totalMins / 60).toFixed(2)}h
                </div>
                {Object.entries(totals)
                  .sort((a, b) => b[1] - a[1])
                  .map(([typeId, mins]) => {
                    const activity = activityTypes.find((t) => t.id === typeId);
                    const pct = ((mins / totalMins) * 100).toFixed(0);
                    return (
                      <div key={typeId} style={{
                        background: 'white',
                        padding: '8px 10px',
                        borderRadius: '6px',
                        fontSize: '12px'
                      }}>
                        <div style={{ color: '#6b7280', marginBottom: '2px' }}>
                          {activity ? activity.label : typeId}
                        </div>
                        <div style={{ fontWeight: 700, color: '#111827' }}>
                          {(mins / 60).toFixed(2)}h <span style={{ color: '#9ca3af', fontWeight: 400 }}>({pct}%)</span>
                        </div>
                      </div>
                    );
                  })}
              </div>
            );
          })()}

          {events.length === 0 ? (
            <div className="no-events">
              <p>No activities logged yet for this date. Click "+ Add Activity" to start tracking your day.</p>
            </div>
          ) : (
            <div className="events-list">
              {events
                .slice()
                .sort((a, b) => (a.time || '').localeCompare(b.time || ''))
                .map((event) => {
                  const typeId = event.activityType || event.activity_type;
                  const activity = activityTypes.find((t) => t.id === typeId);
                  const { endTime, cleanNotes } = parseEventNotes(event.notes);
                  const duration = endTime ? calcEventDuration(event.time, endTime) : null;
                  return (
                    <div key={event.id} className="event-item">
                      <div className="event-header">
                        <div className="event-time-type">
                          <span className="event-time">
                            🕐 {event.time}{endTime ? ` → ${endTime}` : ''}
                          </span>
                          {duration && (
                            <span className="event-duration" style={{
                              background: '#1f2937',
                              color: '#a7f3d0',
                              padding: '2px 8px',
                              borderRadius: '10px',
                              fontSize: '11px',
                              fontWeight: 600
                            }}>
                              {duration}
                            </span>
                          )}
                          <span className="event-type">
                            {activity ? activity.label : typeId}
                          </span>
                        </div>
                        <button
                          onClick={() => handleDeleteEvent(event.id)}
                          className="btn-delete-event"
                          disabled={loading}
                          title="Delete event"
                        >
                          🗑️
                        </button>
                      </div>
                      {cleanNotes && (
                        <div className="event-notes">{cleanNotes}</div>
                      )}
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default TimeLogging;
