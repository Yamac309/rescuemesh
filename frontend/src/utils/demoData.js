import { makeReportId } from "./reportUtils";

export const DEMO_REPORT_TITLES = [
  "Water available at library",
  "Road blocked near main entrance",
  "First aid station at gym",
  "Charging station open at student center",
  "Dangerous flooding near parking lot"
];

const DEMO_LOCATIONS = [
  {
    name: "Library",
    address: "100 Library Walk, RescueMesh Campus",
    latitude: 40.7136,
    longitude: -74.0052,
    categories: ["Water", "Shelter", "General Update", "Need Help"]
  },
  {
    name: "Student Center",
    address: "220 Student Center Plaza, RescueMesh Campus",
    latitude: 40.7116,
    longitude: -74.0044,
    categories: ["Charging", "Food", "Need Help", "General Update"]
  },
  {
    name: "Gym",
    address: "55 Athletics Drive, RescueMesh Campus",
    latitude: 40.715,
    longitude: -74.0039,
    categories: ["First Aid", "Shelter", "Water", "Need Help"]
  },
  {
    name: "Health Center",
    address: "18 Wellness Way, RescueMesh Campus",
    latitude: 40.7142,
    longitude: -74.0028,
    categories: ["First Aid", "Need Help", "General Update"]
  },
  {
    name: "Police Station",
    address: "12 Safety Road, RescueMesh Campus",
    latitude: 40.7162,
    longitude: -74.0066,
    categories: ["General Update", "Need Help", "Dangerous Area"]
  },
  {
    name: "Main Entrance",
    address: "1 Main Entrance Road, RescueMesh Campus",
    latitude: 40.7122,
    longitude: -74.0082,
    categories: ["Blocked Road", "Dangerous Area", "General Update"]
  },
  {
    name: "Parking Lot 4",
    address: "400 West Parking Loop, RescueMesh Campus",
    latitude: 40.7109,
    longitude: -74.0071,
    categories: ["Dangerous Area", "Blocked Road", "Need Help"]
  },
  {
    name: "Shelter Area",
    address: "75 Shelter Field Lane, RescueMesh Campus",
    latitude: 40.713,
    longitude: -74.0015,
    categories: ["Shelter", "Food", "Water", "Need Help"]
  },
  {
    name: "Dining Hall",
    address: "31 Dining Hall Court, RescueMesh Campus",
    latitude: 40.7124,
    longitude: -74.0032,
    categories: ["Food", "Water", "Charging", "General Update"]
  }
];

const CATEGORY_DETAILS = {
  "Need Help": {
    titles: ["People need assistance", "Help requested", "Assistance needed"],
    descriptions: [
      "A small group is waiting for responders and needs a welfare check.",
      "Someone reported difficulty leaving the area and asked for help.",
      "A resident nearby says they need responder support and a status check."
    ],
    urgencies: ["Medium", "High", "Critical"]
  },
  Food: {
    titles: ["Food distribution available", "Meals available", "Food supplies open"],
    descriptions: [
      "Shelf-stable meals are available for pickup. Supplies may run low if demand increases.",
      "Volunteers are handing out snacks and bottled drinks near the entrance.",
      "A food table is open and asking people to form a single line."
    ],
    urgencies: ["Low", "Medium"]
  },
  Water: {
    titles: ["Water available", "Water refill point open", "Bottled water available"],
    descriptions: [
      "Bottled water and a refill station are available near the main desk.",
      "Cases of water were dropped off and are being handed out in small amounts.",
      "A refill point is open, but people should bring their own bottle if possible."
    ],
    urgencies: ["Low", "Medium"]
  },
  Shelter: {
    titles: ["Shelter space open", "Temporary shelter available", "Indoor waiting area open"],
    descriptions: [
      "Indoor space is available for people waiting on transportation or responders.",
      "A temporary shelter area has room for more people and basic supplies.",
      "Staff are directing people inside to stay away from weather and debris."
    ],
    urgencies: ["Low", "Medium", "High"]
  },
  "First Aid": {
    titles: ["First aid station active", "Medical help available", "First aid support set up"],
    descriptions: [
      "Volunteers with first aid kits are set up and can handle minor injuries.",
      "Basic first aid support is available. Serious injuries still need emergency services.",
      "A first aid table is active and asking people to report injuries quickly."
    ],
    urgencies: ["Medium", "High", "Critical"]
  },
  Charging: {
    titles: ["Charging station open", "Power strips available", "Device charging available"],
    descriptions: [
      "Power strips are available. Please limit charging to 20 minutes per device.",
      "Several outlets are open, but the line is growing.",
      "Charging is available for phones and radios. Larger equipment is not supported."
    ],
    urgencies: ["Low", "Medium"]
  },
  "Blocked Road": {
    titles: ["Road blocked", "Entrance blocked", "Route partially blocked"],
    descriptions: [
      "Debris is blocking one lane. Use an alternate route until crews arrive.",
      "A fallen branch and standing water are slowing traffic near the entrance.",
      "Vehicles are turning around because the route is blocked by debris."
    ],
    urgencies: ["Medium", "High", "Critical"]
  },
  "Dangerous Area": {
    titles: ["Dangerous area reported", "Flooding hazard reported", "Unsafe area marked"],
    descriptions: [
      "Standing water is rising nearby. Avoid walking or driving through it.",
      "Loose debris and slippery ground are creating a hazard.",
      "People are being asked to keep clear until responders inspect the area."
    ],
    urgencies: ["High", "Critical"]
  },
  "General Update": {
    titles: ["Situation update", "Responder update", "Operations update"],
    descriptions: [
      "Responders are checking the area and asking people to keep walkways clear.",
      "The area is passable, but conditions are changing quickly.",
      "Volunteers are collecting updates and directing people to safer routes."
    ],
    urgencies: ["Low", "Medium"]
  }
};

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick(items) {
  return items[randomInt(0, items.length - 1)];
}

function shuffled(items) {
  return [...items].sort(() => Math.random() - 0.5);
}

function jitter(value, amount = 0.00032) {
  return Number((value + (Math.random() * 2 - 1) * amount).toFixed(6));
}

export function makeDemoReports(deviceId) {
  const now = Date.now();
  const count = randomInt(4, 10);
  const locations = shuffled(DEMO_LOCATIONS);

  return Array.from({ length: count }, (_, index) => {
    const location = locations[index % locations.length];
    const category = pick(location.categories);
    const details = CATEGORY_DETAILS[category];
    const minutesAgo = randomInt(5, 95);

    return {
      report_id: makeReportId(deviceId),
      title: `${pick(details.titles)} at ${location.name}`,
      category,
      description: pick(details.descriptions),
      urgency: pick(details.urgencies),
      location_name: location.name,
      location_address: location.address,
      latitude: jitter(location.latitude),
      longitude: jitter(location.longitude),
      status: "Unverified",
      timestamp: new Date(now - minutesAgo * 60 * 1000).toISOString(),
      device_id: deviceId,
      photo_evidence_attached: Math.random() > 0.72,
      is_demo: true,
      confirmation_count: 0,
      confirmed_by_device_ids: [],
      sync_state: "pending"
    };
  });
}
