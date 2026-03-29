import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useEffect, useState, lazy, Suspense } from 'react';
import { Layout } from './components/Layout';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Loader2 } from 'lucide-react';

function lazyRetry(factory: () => Promise<any>, retries = 2): Promise<any> {
    return factory().catch((err: any) => {
        if (retries <= 0) throw err;
        return new Promise(resolve => setTimeout(resolve, 1000)).then(() => lazyRetry(factory, retries - 1));
    });
}

const Dashboard = lazy(() => lazyRetry(() => import('./pages/Dashboard').then(m => ({ default: m.Dashboard }))));
const NewInvestigation = lazy(() => lazyRetry(() => import('./pages/NewInvestigation').then(m => ({ default: m.NewInvestigation }))));
const InvestigationDetail = lazy(() => lazyRetry(() => import('./pages/InvestigationDetail').then(m => ({ default: m.InvestigationDetail }))));
const Settings = lazy(() => lazyRetry(() => import('./pages/Settings').then(m => ({ default: m.Settings }))));
const About = lazy(() => lazyRetry(() => import('./pages/About').then(m => ({ default: m.About }))));
const Schedules = lazy(() => lazyRetry(() => import('./pages/Schedules').then(m => ({ default: m.Schedules }))));
const ScheduleForm = lazy(() => lazyRetry(() => import('./pages/ScheduleForm').then(m => ({ default: m.ScheduleForm }))));
const OnboardingWizard = lazy(() => lazyRetry(() => import('./pages/OnboardingWizard').then(m => ({ default: m.OnboardingWizard }))));
const NotFound = lazy(() => lazyRetry(() => import('./pages/NotFound').then(m => ({ default: m.NotFound }))));

export { lazyRetry };

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
    let cancelled = false;
    fetch('/api/onboarding/status')
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (!cancelled) setNeedsOnboarding(data && !data.complete); })
      .catch(() => { if (!cancelled) setNeedsOnboarding(false); });
    return () => { cancelled = true; };
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
