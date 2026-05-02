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

function Shell({ mesh }) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <RadioTower size={30} />
          <div>
            <strong>RescueMesh</strong>
            <span>Online response node</span>
          </div>
        </div>
        <nav>
          <NavLink to="/">
            <LayoutDashboard size={19} /> Dashboard
          </NavLink>
          <NavLink to="/map">
            <Map size={19} /> Map
          </NavLink>
          <NavLink to="/create">
            <PlusCircle size={19} /> Create Report
          </NavLink>
          <NavLink to="/timeline">
            <Clock size={19} /> Timeline
          </NavLink>
          <NavLink to="/node">
            <Activity size={19} /> Node Status
          </NavLink>
          <NavLink to="/responder">
            <ShieldCheck size={19} /> Responder Mode
          </NavLink>
          <NavLink to="/about">
            <Info size={19} /> About
          </NavLink>
        </nav>
        <div className="device-chip" title={mesh.deviceId}>
          Device: {mesh.deviceId.slice(0, 18)}...
        </div>
      </aside>
      <main>
        <Routes>
          <Route path="/" element={<Dashboard mesh={mesh} />} />
          <Route path="/map" element={<MapPage mesh={mesh} />} />
          <Route path="/create" element={<CreateReportPage mesh={mesh} />} />
          <Route path="/timeline" element={<TimelinePage reports={mesh.reports} />} />
          <Route path="/node" element={<NodeStatusPage mesh={mesh} />} />
          <Route path="/responder" element={<ResponderModePage mesh={mesh} />} />
          <Route path="/about" element={<AboutPage />} />
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
