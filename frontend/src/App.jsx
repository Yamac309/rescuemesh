import { BrowserRouter, NavLink, Route, Routes } from "react-router-dom";
import { Activity, Clock, Info, LayoutDashboard, Map, PlusCircle, RadioTower, ShieldCheck } from "lucide-react";
import Dashboard from "./pages/Dashboard";
import MapPage from "./pages/MapPage";
import CreateReportPage from "./pages/CreateReportPage";
import TimelinePage from "./pages/TimelinePage";
import NodeStatusPage from "./pages/NodeStatusPage";
import AboutPage from "./pages/AboutPage";
import ResponderModePage from "./pages/ResponderModePage";
import { useReports } from "./hooks/useReports";

const NAV_LINKS = [
  { to: "/",          icon: <LayoutDashboard size={17} />, label: "Dashboard" },
  { to: "/map",       icon: <Map size={17} />,             label: "Map" },
  { to: "/create",    icon: <PlusCircle size={17} />,      label: "Create Report" },
  { to: "/timeline",  icon: <Clock size={17} />,           label: "Timeline" },
  { to: "/node",      icon: <Activity size={17} />,        label: "Node Status" },
  { to: "/responder", icon: <ShieldCheck size={17} />,     label: "Responder" },
  { to: "/about",     icon: <Info size={17} />,            label: "About" },
];

function Shell({ mesh }) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <RadioTower size={26} />
          <div>
            <strong>RescueMesh</strong>
            <span>Online response node</span>
          </div>
        </div>
        <nav>
          {NAV_LINKS.map(({ to, icon, label }) => (
            <NavLink key={to} to={to} end={to === "/"}>
              {icon} {label}
            </NavLink>
          ))}
        </nav>
        <div className="device-chip" title={mesh.deviceId}>
          {mesh.deviceId.slice(0, 22)}...
        </div>
      </aside>
      <main>
        <Routes>
          <Route path="/"          element={<Dashboard mesh={mesh} />} />
          <Route path="/map"       element={<MapPage mesh={mesh} />} />
          <Route path="/create"    element={<CreateReportPage mesh={mesh} />} />
          <Route path="/timeline"  element={<TimelinePage reports={mesh.reports} />} />
          <Route path="/node"      element={<NodeStatusPage mesh={mesh} />} />
          <Route path="/responder" element={<ResponderModePage mesh={mesh} />} />
          <Route path="/about"     element={<AboutPage />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  const mesh = useReports();
  return (
    <BrowserRouter>
      <Shell mesh={mesh} />
    </BrowserRouter>
  );
}
