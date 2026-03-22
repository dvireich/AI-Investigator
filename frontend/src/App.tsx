import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { NewInvestigation } from './pages/NewInvestigation';
import { InvestigationDetail } from './pages/InvestigationDetail';
import { Settings } from './pages/Settings';
import { About } from './pages/About';
import { Schedules } from './pages/Schedules';
import { ScheduleForm } from './pages/ScheduleForm';
import { OnboardingWizard } from './pages/OnboardingWizard';

function OnboardingRedirect({ children }: { children: React.ReactNode }) {
  const [needsOnboarding, setNeedsOnboarding] = useState<boolean | null>(null);

  useEffect(() => {
    fetch('/api/onboarding/status')
      .then(r => r.ok ? r.json() : null)
      .then(data => setNeedsOnboarding(data && !data.complete))
      .catch(() => setNeedsOnboarding(false));
  }, []);

  if (needsOnboarding === null) return null; // loading
  if (needsOnboarding) return <Navigate to="/onboarding" replace />;
  return <>{children}</>;
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/onboarding" element={<OnboardingWizard />} />
        <Route path="/" element={<Layout />}>
          <Route index element={<OnboardingRedirect><Dashboard /></OnboardingRedirect>} />
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
