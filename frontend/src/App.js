import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { AppLayout } from "@/components/layout/AppLayout";
import { Toaster } from "@/components/ui/sonner";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import SignIn from "@/pages/SignIn";
import ForgotPassword from "@/pages/ForgotPassword";
import AcceptInvitation from "@/pages/AcceptInvitation";
import Dashboard from "@/pages/Dashboard";
import PlayersList from "@/pages/PlayersList";
import ImportPlayers from "@/pages/ImportPlayers";
import PlayerProfile from "@/pages/PlayerProfile";
import EventsList from "@/pages/EventsList";
import EventDetail from "@/pages/EventDetail";
import Evaluate from "@/pages/Evaluate";
import EvaluationForm from "@/pages/EvaluationForm";
import EvaluationResults from "@/pages/EvaluationResults";
import MyEvaluations from "@/pages/MyEvaluations";
import ReviewQueue from "@/pages/ReviewQueue";
import Reports from "@/pages/Reports";
import Development from "@/pages/Development";
import Staff from "@/pages/Staff";
import Templates from "@/pages/Templates";
import Settings from "@/pages/Settings";
import AuditLog from "@/pages/AuditLog";
import MyId from "@/pages/MyId";
import MyIdEdit from "@/pages/MyIdEdit";
import Landing from "@/pages/Landing";
import Programs from "@/pages/Programs";
import ProgramDetail from "@/pages/ProgramDetail";
import Story from "@/pages/Story";
import Redeem from "@/pages/Redeem";
import Drills from "@/pages/Drills";
import Scout from "@/pages/Scout";
import PlayerCompare from "@/pages/PlayerCompare";

const Protected = ({ children }) => {
  const { user, loading } = useAuth();
  if (loading)
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    );
  if (!user) return <Navigate to="/signin" replace />;
  return <AppLayout>{children}</AppLayout>;
};

const StaffOnly = ({ children }) => {
  const { user } = useAuth();
  if (user?.role === "athlete" || user?.role === "parent") {
    return <Navigate to="/my-id" replace />;
  }
  return children;
};

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <ErrorBoundary>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/signin" element={<SignIn />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/accept-invitation" element={<AcceptInvitation />} />
          <Route path="/story/:slug" element={<Story />} />
          <Route path="/redeem" element={<Redeem />} />
          <Route path="/my-id" element={<Protected><MyId /></Protected>} />
            <Route path="/my-id/edit" element={<Protected><MyIdEdit /></Protected>} />
            <Route path="/dashboard" element={<Protected><StaffOnly><Dashboard /></StaffOnly></Protected>} />
            <Route path="/programs" element={<Protected><StaffOnly><Programs /></StaffOnly></Protected>} />
            <Route path="/programs/:programId" element={<Protected><StaffOnly><ProgramDetail /></StaffOnly></Protected>} />
            <Route path="/players" element={<Protected><StaffOnly><PlayersList /></StaffOnly></Protected>} />
            <Route path="/players/import" element={<Protected><StaffOnly><ImportPlayers /></StaffOnly></Protected>} />
            <Route path="/players/:athleteId" element={<Protected><StaffOnly><PlayerProfile /></StaffOnly></Protected>} />
            <Route path="/events" element={<Protected><StaffOnly><EventsList /></StaffOnly></Protected>} />
            <Route path="/events/:eventId" element={<Protected><StaffOnly><EventDetail /></StaffOnly></Protected>} />
            <Route path="/evaluate" element={<Protected><StaffOnly><Evaluate /></StaffOnly></Protected>} />
            <Route path="/evaluate/:assignmentId" element={<Protected><StaffOnly><Evaluate /></StaffOnly></Protected>} />
            <Route path="/evaluation/:evaluationId" element={<Protected><StaffOnly><EvaluationForm /></StaffOnly></Protected>} />
            <Route path="/evaluation/:evaluationId/results" element={<Protected><StaffOnly><EvaluationResults /></StaffOnly></Protected>} />
            <Route path="/my-evaluations" element={<Protected><StaffOnly><MyEvaluations /></StaffOnly></Protected>} />
            <Route path="/review" element={<Protected><StaffOnly><ReviewQueue /></StaffOnly></Protected>} />
            <Route path="/scout" element={<Protected><StaffOnly><Scout /></StaffOnly></Protected>} />
            <Route path="/scout/compare" element={<Protected><StaffOnly><PlayerCompare /></StaffOnly></Protected>} />
            <Route path="/reports" element={<Protected><StaffOnly><Reports /></StaffOnly></Protected>} />
            <Route path="/development" element={<Protected><StaffOnly><Development /></StaffOnly></Protected>} />
            <Route path="/staff" element={<Protected><StaffOnly><Staff /></StaffOnly></Protected>} />
          <Route path="/templates" element={<Protected><StaffOnly><Templates /></StaffOnly></Protected>} />
          <Route path="/drills" element={<Protected><StaffOnly><Drills /></StaffOnly></Protected>} />
          <Route path="/settings" element={<Protected><Settings /></Protected>} />
            <Route path="/audit-log" element={<Protected><StaffOnly><AuditLog /></StaffOnly></Protected>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          <Toaster position="top-center" richColors />
        </ErrorBoundary>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
