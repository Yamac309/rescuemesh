import { makeReportId } from "./reportUtils";

export function makeDemoReports(deviceId) {
  const now = Date.now();
  const base = {
    device_id: deviceId,
    status: "Unverified",
    confirmation_count: 0,
    confirmed_by_device_ids: [],
    sync_state: "pending"
  };

  return [
    {
      ...base,
      report_id: makeReportId(deviceId),
      title: "Water available at library",
      category: "Water",
      description: "Bottled water and refill station available near the main desk.",
      urgency: "Medium",
      latitude: 40.7136,
      longitude: -74.0052,
      timestamp: new Date(now - 45 * 60 * 1000).toISOString()
    },
    {
      ...base,
      report_id: makeReportId(deviceId),
      title: "Road blocked near main entrance",
      category: "Blocked Road",
      description: "Tree and debris blocking the north entrance. Use the east access road.",
      urgency: "High",
      latitude: 40.7122,
      longitude: -74.0082,
      timestamp: new Date(now - 38 * 60 * 1000).toISOString()
    },
    {
      ...base,
      report_id: makeReportId(deviceId),
      title: "First aid station at gym",
      category: "First Aid",
      description: "Volunteers with first aid kits are set up inside the gym lobby.",
      urgency: "High",
      latitude: 40.715,
      longitude: -74.0039,
      timestamp: new Date(now - 28 * 60 * 1000).toISOString()
    },
    {
      ...base,
      report_id: makeReportId(deviceId),
      title: "Charging station open at student center",
      category: "Charging",
      description: "Power strips available. Please limit charging to 20 minutes per device.",
      urgency: "Low",
      latitude: 40.7116,
      longitude: -74.0044,
      timestamp: new Date(now - 16 * 60 * 1000).toISOString()
    },
    {
      ...base,
      report_id: makeReportId(deviceId),
      title: "Dangerous flooding near parking lot",
      category: "Dangerous Area",
      description: "Standing water is rising near the west parking lot. Avoid walking through it.",
      urgency: "Critical",
      latitude: 40.7109,
      longitude: -74.0071,
      timestamp: new Date(now - 8 * 60 * 1000).toISOString()
    }
  ];
}
