import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useEffect, useState, lazy, Suspense } from 'react';
import { Layout } from './components/Layout';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Loader2 } from 'lucide-react';

const Dashboard = lazy(() => import('./pages/Dashboard').then(m => ({ default: m.Dashboard })));
const NewInvestigation = lazy(() => import('./pages/NewInvestigation').then(m => ({ default: m.NewInvestigation })));
const InvestigationDetail = lazy(() => import('./pages/InvestigationDetail').then(m => ({ default: m.InvestigationDetail })));
const Settings = lazy(() => import('./pages/Settings').then(m => ({ default: m.Settings })));
const About = lazy(() => import('./pages/About').then(m => ({ default: m.About })));
const Schedules = lazy(() => import('./pages/Schedules').then(m => ({ default: m.Schedules })));
const ScheduleForm = lazy(() => import('./pages/ScheduleForm').then(m => ({ default: m.ScheduleForm })));
const OnboardingWizard = lazy(() => import('./pages/OnboardingWizard').then(m => ({ default: m.OnboardingWizard })));
const NotFound = lazy(() => import('./pages/NotFound').then(m => ({ default: m.NotFound })));

function PageLoader() {
  return (
    <div className="flex items-center justify-center min-h-[40vh]">
      <Loader2 className="w-8 h-8 text-brand-400 animate-spin" />
    </div>
  );
}

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
    <ErrorBoundary>
      <BrowserRouter>
        <Suspense fallback={<PageLoader />}>
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
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
        </Suspense>
      </BrowserRouter>
    </ErrorBoundary>
  );
}

export default App;
