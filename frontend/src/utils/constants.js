export const CATEGORIES = [
  "Need Help",
  "Food",
  "Water",
  "Shelter",
  "First Aid",
  "Charging",
  "Blocked Road",
  "Dangerous Area",
  "General Update"
];

export const URGENCY_LEVELS = ["Low", "Medium", "High", "Critical"];
export const STATUSES = ["Unverified", "Confirmed", "Needs Review", "Resolved"];

export const USA_CENTER = [39.8283, -98.5795];
export const USA_BOUNDS = [
  [24.396308, -124.848974],
  [49.384358, -66.885444]
];

export function isInsideUsaBounds(item) {
  const latitude = Number(item.latitude);
  const longitude = Number(item.longitude);
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= USA_BOUNDS[0][0] &&
    latitude <= USA_BOUNDS[1][0] &&
    longitude >= USA_BOUNDS[0][1] &&
    longitude <= USA_BOUNDS[1][1]
  );
}

export const CATEGORY_MARKERS = {
  "Need Help": "HELP",
  Food: "FOOD",
  Water: "H2O",
  Shelter: "HOME",
  "First Aid": "AID",
  Charging: "PWR",
  "Blocked Road": "ROAD",
  "Dangerous Area": "RISK",
  "General Update": "INFO"
};

export const URGENCY_CLASS = {
  Low: "urgency-low",
  Medium: "urgency-medium",
  High: "urgency-high",
  Critical: "urgency-critical"
};
