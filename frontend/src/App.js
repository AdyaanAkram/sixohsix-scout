import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { AppLayout } from "@/components/layout/AppLayout";
import { Toaster } from "@/components/ui/sonner";
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
import MyEvaluations from "@/pages/MyEvaluations";
import ReviewQueue from "@/pages/ReviewQueue";
import Reports from "@/pages/Reports";
import Development from "@/pages/Development";
import Staff from "@/pages/Staff";
import Templates from "@/pages/Templates";
import Settings from "@/pages/Settings";
import AuditLog from "@/pages/AuditLog";

const Protected = ({ children }) => {
  const { user, loading } = useAuth();
  if (loading)
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="h-8 w-8 rounded-full border-2 border-[#0B1E3A] border-t-transparent animate-spin" />
      </div>
    );
  if (!user) return <Navigate to="/signin" replace />;
  return <AppLayout>{children}</AppLayout>;
};

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/signin" element={<SignIn />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/accept-invitation" element={<AcceptInvitation />} />
          <Route path="/" element={<Protected><Dashboard /></Protected>} />
          <Route path="/players" element={<Protected><PlayersList /></Protected>} />
          <Route path="/players/import" element={<Protected><ImportPlayers /></Protected>} />
          <Route path="/players/:athleteId" element={<Protected><PlayerProfile /></Protected>} />
          <Route path="/events" element={<Protected><EventsList /></Protected>} />
          <Route path="/events/:eventId" element={<Protected><EventDetail /></Protected>} />
          <Route path="/evaluate" element={<Protected><Evaluate /></Protected>} />
          <Route path="/evaluate/:assignmentId" element={<Protected><Evaluate /></Protected>} />
          <Route path="/evaluation/:evaluationId" element={<Protected><EvaluationForm /></Protected>} />
          <Route path="/my-evaluations" element={<Protected><MyEvaluations /></Protected>} />
          <Route path="/review" element={<Protected><ReviewQueue /></Protected>} />
          <Route path="/reports" element={<Protected><Reports /></Protected>} />
          <Route path="/development" element={<Protected><Development /></Protected>} />
          <Route path="/staff" element={<Protected><Staff /></Protected>} />
          <Route path="/templates" element={<Protected><Templates /></Protected>} />
          <Route path="/settings" element={<Protected><Settings /></Protected>} />
          <Route path="/audit-log" element={<Protected><AuditLog /></Protected>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
      <Toaster position="top-center" richColors />
    </AuthProvider>
  );
}

export default App;
