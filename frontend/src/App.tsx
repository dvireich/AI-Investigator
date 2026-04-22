import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { lazy, Suspense } from 'react';
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
const NotFound = lazy(() => lazyRetry(() => import('./pages/NotFound').then(m => ({ default: m.NotFound }))));

export { lazyRetry };

function PageLoader() {
  return (
    <div className="flex items-center justify-center min-h-[40vh]">
      <Loader2 className="w-8 h-8 text-brand-400 animate-spin" />
    </div>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <Suspense fallback={<PageLoader />}>
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
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
        </Suspense>
      </BrowserRouter>
    </ErrorBoundary>
  );
}

export default App;
