import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { NewInvestigation } from './pages/NewInvestigation';
import { InvestigationDetail } from './pages/InvestigationDetail';
import { Settings } from './pages/Settings';
import { About } from './pages/About';
import { Schedules } from './pages/Schedules';
import { ScheduleForm } from './pages/ScheduleForm';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="new" element={<NewInvestigation />} />
          <Route path="investigation/:id" element={<InvestigationDetail />} />
          <Route path="schedules" element={<Schedules />} />
          <Route path="schedules/new" element={<ScheduleForm />} />
          <Route path="schedules/:id/edit" element={<ScheduleForm />} />
          <Route path="settings" element={<Settings />} />
          <Route path="about" element={<About />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
