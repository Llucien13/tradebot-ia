import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import FTMO20K from "./pages/FTMO20K";
import NotFound from "./pages/NotFound";
import MonitorLayout from "./components/monitor/MonitorLayout";

const WorkspaceV85 = lazy(() => import("./pages/WorkspaceV85"));
const MonitorPositions = lazy(() => import("./pages/MonitorPositions"));
const MonitorJournalPage = lazy(() => import("./pages/MonitorJournalPage"));
const MonitorCalendarPage = lazy(() => import("./pages/MonitorCalendarPage"));
const MonitorStatistics = lazy(() => import("./pages/MonitorStatistics"));
const MonitorHealth = lazy(() => import("./pages/MonitorHealth"));
const ConnectionMT5 = lazy(() => import("./pages/ConnectionMT5"));
const CloudPaperPage = lazy(() => import("./pages/CloudPaperPage"));
const CloudMonitorPage = lazy(() => import("./pages/CloudMonitorPage"));
const Journal = lazy(() => import("./pages/Journal"));
const Settings = lazy(() => import("./pages/Settings"));
const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Suspense fallback={<p role="status" className="p-6 text-sm text-muted-foreground">Chargement de la rubrique…</p>}>
          <Routes>
            <Route element={<MonitorLayout />}>
              <Route path="/" element={<Index />} />
              <Route path="/positions" element={<MonitorPositions />} />
              <Route path="/journal-paper" element={<MonitorJournalPage />} />
              <Route path="/calendrier-paper" element={<MonitorCalendarPage />} />
              <Route path="/statistiques" element={<MonitorStatistics />} />
              <Route path="/etat" element={<MonitorHealth />} />
            </Route>
            <Route path="/cloud-paper" element={<CloudPaperPage />} />
            <Route path="/cloud-monitor" element={<CloudMonitorPage />} />
            <Route element={<FTMO20K />}>
              <Route path="/v85" element={<WorkspaceV85 />} />
              <Route path="/mt5" element={<ConnectionMT5 />} />
              <Route path="/historique" element={<Journal />} />
              <Route path="/settings" element={<Settings />} />
            </Route>
            <Route path="/ftmo-20k" element={<Navigate to="/v85" replace />} />
            <Route path="/scalping" element={<Navigate to="/" replace />} />
            <Route path="/scalping-m1" element={<Navigate to="/" replace />} />
            <Route path="/scalping-m5" element={<Navigate to="/" replace />} />
            <Route path="/strategy-h1" element={<Navigate to="/" replace />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
