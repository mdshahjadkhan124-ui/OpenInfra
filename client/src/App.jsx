/**
 * Routing.
 *
 * Grouped by who can see what. Guards decide what renders; the server decides
 * what is permitted — a citizen who types /admin gets 403s from every request
 * the page makes regardless of what this file says.
 */
import { Navigate, Route, Routes } from 'react-router-dom';

import { PublicLayout } from './layouts/PublicLayout.jsx';
import { AuthLayout } from './layouts/AuthLayout.jsx';
import { DashboardLayout } from './layouts/DashboardLayout.jsx';
import { RequireAuth, RequireGuest } from './components/ProtectedRoute.jsx';
import { ROLES } from './lib/constants.js';

import { Landing } from './pages/public/Landing.jsx';
import { Transparency } from './pages/public/Transparency.jsx';
import { ProjectDetail } from './pages/public/ProjectDetail.jsx';
import { NotFound } from './pages/public/NotFound.jsx';

import { Login } from './pages/auth/Login.jsx';
import { Register } from './pages/auth/Register.jsx';
import { OAuthCallback } from './pages/auth/OAuthCallback.jsx';

import { CitizenHome } from './pages/citizen/CitizenHome.jsx';
import { ReportIssue } from './pages/citizen/ReportIssue.jsx';
import { MyReports } from './pages/citizen/MyReports.jsx';

import { ContractorHome } from './pages/contractor/ContractorHome.jsx';
import { OpenProjects } from './pages/contractor/OpenProjects.jsx';
import { MyBids } from './pages/contractor/MyBids.jsx';
import { AwardedWork } from './pages/contractor/AwardedWork.jsx';

import { AdminHome } from './pages/admin/AdminHome.jsx';
import { ReviewReports } from './pages/admin/ReviewReports.jsx';
import { ProjectsBids } from './pages/admin/ProjectsBids.jsx';
import { Milestones } from './pages/admin/Milestones.jsx';

export const App = () => (
  <Routes>
    {/* ---------------------------------------------------------- public */}
    <Route element={<PublicLayout />}>
      <Route index element={<Landing />} />
      <Route path="transparency" element={<Transparency />} />
      {/* Emails and in-app links point here; both resolve to a real page. */}
      <Route path="transparency/projects/:id" element={<ProjectDetail />} />
    </Route>

    {/* ------------------------------------------------------------ auth */}
    {/* The OAuth callback sits outside RequireGuest: it runs *while*
        becoming authenticated, so a guest guard would redirect it away
        mid-flight. */}
    <Route path="/auth/callback" element={<OAuthCallback />} />

    <Route element={<RequireGuest />}>
      <Route element={<AuthLayout />}>
        <Route path="login" element={<Login />} />
        <Route path="register" element={<Register />} />
      </Route>
    </Route>

    {/* --------------------------------------------------------- citizen */}
    <Route element={<RequireAuth roles={[ROLES.CITIZEN]} />}>
      <Route path="citizen" element={<DashboardLayout />}>
        <Route index element={<CitizenHome />} />
        <Route path="report" element={<ReportIssue />} />
        <Route path="reports" element={<MyReports />} />
      </Route>
    </Route>

    {/* ------------------------------------------------------ contractor */}
    <Route element={<RequireAuth roles={[ROLES.CONTRACTOR]} />}>
      <Route path="contractor" element={<DashboardLayout />}>
        <Route index element={<ContractorHome />} />
        <Route path="projects" element={<OpenProjects />} />
        <Route path="bids" element={<MyBids />} />
        <Route path="awarded" element={<AwardedWork />} />
      </Route>
    </Route>

    {/* ----------------------------------------------------------- admin */}
    <Route element={<RequireAuth roles={[ROLES.ADMIN]} />}>
      <Route path="admin" element={<DashboardLayout />}>
        <Route index element={<AdminHome />} />
        <Route path="reports" element={<ReviewReports />} />
        <Route path="projects" element={<ProjectsBids />} />
        <Route path="projects/:id/bids" element={<ProjectsBids />} />
        <Route path="milestones" element={<Milestones />} />
        <Route path="milestones/:id" element={<Milestones />} />
      </Route>
    </Route>

    {/* The dashboard sidebar links to /transparency for every role. */}
    <Route path="/dashboard" element={<Navigate to="/" replace />} />
    <Route path="*" element={<NotFound />} />
  </Routes>
);

export default App;
