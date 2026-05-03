import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import { Layout } from './components/Layout';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Loader2 } from 'lucide-react';
// Eager imports for the two pages on the critical user path: viewing the
// dashboard and starting a new investigation. Code-splitting these only
// added a chunk-download delay before the user could do the primary action.
import { Dashboard } from './pages/Dashboard';
import { NewInvestigation } from './pages/NewInvestigation';

function lazyRetry(factory: () => Promise<any>, retries = 2): Promise<any> {
    return factory().catch((err: any) => {
        if (retries <= 0) throw err;
        return new Promise(resolve => setTimeout(resolve, 1000)).then(() => lazyRetry(factory, retries - 1));
    });
}

// Wrap a dynamic import so we can both lazy-mount and prefetch the chunk on demand.
function lazyWithPreload<T extends Record<string, any>>(factory: () => Promise<T>) {
    let cached: Promise<T> | null = null;
    const load = () => {
        if (!cached) cached = lazyRetry(factory) as Promise<T>;
        return cached;
    };
    const Component = lazy(load);
    (Component as any).preload = load;
    return Component as typeof Component & { preload: () => Promise<T> };
}

const InvestigationDetail = lazyWithPreload(() => import('./pages/InvestigationDetail').then(m => ({ default: m.InvestigationDetail })));
const Settings = lazyWithPreload(() => import('./pages/Settings').then(m => ({ default: m.Settings })));
const About = lazyWithPreload(() => import('./pages/About').then(m => ({ default: m.About })));
const Schedules = lazyWithPreload(() => import('./pages/Schedules').then(m => ({ default: m.Schedules })));
const ScheduleForm = lazyWithPreload(() => import('./pages/ScheduleForm').then(m => ({ default: m.ScheduleForm })));
const NotFound = lazyWithPreload(() => import('./pages/NotFound').then(m => ({ default: m.NotFound })));

/**
 * Map of route paths to preload functions for their lazy-loaded page chunks.
 * Used to prefetch a route's JS bundle on hover/focus or during browser idle
 * time, so navigation doesn't pay the chunk-download cost on click.
 * Note: '/' and '/new' are eagerly imported, so they have no preload entry.
 */
export const preloadRoute: Record<string, () => Promise<unknown>> = {
    '/schedules': Schedules.preload,
    '/schedules/new': ScheduleForm.preload,
    '/settings': Settings.preload,
    '/about': About.preload,
};

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
