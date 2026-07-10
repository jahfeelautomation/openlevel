import { Navigate, Route, Routes } from 'react-router-dom'
import { Spinner } from './components/ui/spinner'
import { AffiliatesPage } from './features/affiliates/AffiliatesPage'
import { AssistantPage } from './features/assistant/AssistantPage'
import { AutomationsPage } from './features/automations/AutomationsPage'
import { LoginPage } from './features/auth/LoginPage'
import { BlogPage } from './features/blog/BlogPage'
import { CalendarsPage } from './features/calendars/CalendarsPage'
import { CallsPage } from './features/calls/CallsPage'
import { CommunitiesPage } from './features/communities/CommunitiesPage'
import { ContactsPage } from './features/contacts/ContactsPage'
import { InboxPage } from './features/conversations/InboxPage'
import { CustomFieldsPage } from './features/custom-fields/CustomFieldsPage'
import { CustomValuesPage } from './features/custom-values/CustomValuesPage'
import { FormsPage } from './features/forms/FormsPage'
import { MarketingPage } from './features/marketing/MarketingPage'
import { MembershipsPage } from './features/memberships/MembershipsPage'
import { OpportunitiesPage } from './features/opportunities/OpportunitiesPage'
import { CouponsPage } from './features/payments/CouponsPage'
import { PaymentsLayout } from './features/payments/PaymentsLayout'
import { PaymentsPage } from './features/payments/PaymentsPage'
import { ProductsPage } from './features/payments/ProductsPage'
import { SubscriptionsPage } from './features/payments/SubscriptionsPage'
import { TransactionsPage } from './features/payments/TransactionsPage'
import { ProposalsPage } from './features/proposals/ProposalsPage'
import { ReportingPage } from './features/reporting/ReportingPage'
import { ReputationPage } from './features/reputation/ReputationPage'
import { AgentSettingsPage } from './features/settings/AgentSettingsPage'
import { PaymentsSettingsPage } from './features/settings/PaymentsSettingsPage'
import { SendingSettingsPage } from './features/settings/SendingSettingsPage'
import { SocialSettingsPage } from './features/settings/SocialSettingsPage'
import { VoiceSettingsPage } from './features/settings/VoiceSettingsPage'
import { PipelinesSettingsPage } from './features/settings/PipelinesSettingsPage'
import { SettingsLayout } from './features/settings/SettingsLayout'
import { AppShell } from './features/shell/AppShell'
import { SitesPage } from './features/sites/SitesPage'
import { SocialPage } from './features/social/SocialPage'
import { SurveysPage } from './features/surveys/SurveysPage'
import { TagsPage } from './features/tags/TagsPage'
import { TasksPage } from './features/tasks/TasksPage'
import { TemplatesPage } from './features/templates/TemplatesPage'
import { TriggerLinksPage } from './features/trigger-links/TriggerLinksPage'
import { AuthProvider, useAuth } from './state/auth'
import { TenantProvider } from './state/location'

function FullScreenSpinner() {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-slate-100">
      <Spinner className="h-7 w-7" />
    </div>
  )
}

/** Auth gate + tenant scope for every signed-in page. Renders the shell (which
 *  has its own <Outlet/>) so the routed page shows inside the frame. */
function ProtectedLayout() {
  const { status } = useAuth()
  if (status === 'loading') return <FullScreenSpinner />
  if (status === 'anon') return <Navigate to="/login" replace />
  return (
    <TenantProvider>
      <AppShell />
    </TenantProvider>
  )
}

function LoginRoute() {
  const { status } = useAuth()
  if (status === 'loading') return <FullScreenSpinner />
  if (status === 'authed') return <Navigate to="/" replace />
  return <LoginPage />
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginRoute />} />
        <Route element={<ProtectedLayout />}>
          <Route index element={<Navigate to="/assistant" replace />} />
          <Route path="assistant" element={<AssistantPage />} />
          <Route path="conversations" element={<InboxPage />} />
          <Route path="conversations/:id" element={<InboxPage />} />
          <Route path="contacts" element={<ContactsPage />} />
          <Route path="contacts/:id" element={<ContactsPage />} />
          <Route path="tags" element={<TagsPage />} />
          <Route path="settings" element={<SettingsLayout />}>
            <Route index element={<Navigate to="/settings/pipelines" replace />} />
            <Route path="pipelines" element={<PipelinesSettingsPage />} />
            <Route path="custom-fields" element={<CustomFieldsPage />} />
            <Route path="custom-values" element={<CustomValuesPage />} />
            <Route path="agent" element={<AgentSettingsPage />} />
            <Route path="payments" element={<PaymentsSettingsPage />} />
            <Route path="sending" element={<SendingSettingsPage />} />
            <Route path="social" element={<SocialSettingsPage />} />
            <Route path="voice" element={<VoiceSettingsPage />} />
          </Route>
          {/* Custom Fields + Custom Values moved under Settings; keep the old
              top-level links working for any saved bookmarks. */}
          <Route path="custom-fields" element={<Navigate to="/settings/custom-fields" replace />} />
          <Route path="custom-values" element={<Navigate to="/settings/custom-values" replace />} />
          <Route path="opportunities" element={<OpportunitiesPage />} />
          <Route path="tasks" element={<TasksPage />} />
          <Route path="calendars" element={<CalendarsPage />} />
          <Route path="calls" element={<CallsPage />} />
          <Route path="marketing" element={<MarketingPage />} />
          <Route path="templates" element={<TemplatesPage />} />
          <Route path="social" element={<SocialPage />} />
          <Route path="automations" element={<AutomationsPage />} />
          <Route path="reporting" element={<ReportingPage />} />
          <Route path="sites" element={<SitesPage />} />
          <Route path="forms" element={<FormsPage />} />
          <Route path="surveys" element={<SurveysPage />} />
          <Route path="payments" element={<PaymentsLayout />}>
            <Route index element={<Navigate to="/payments/invoices" replace />} />
            <Route path="invoices" element={<PaymentsPage />} />
            <Route path="products" element={<ProductsPage />} />
            <Route path="subscriptions" element={<SubscriptionsPage />} />
            <Route path="coupons" element={<CouponsPage />} />
            <Route path="transactions" element={<TransactionsPage />} />
          </Route>
          <Route path="proposals" element={<ProposalsPage />} />
          <Route path="reputation" element={<ReputationPage />} />
          <Route path="memberships" element={<MembershipsPage />} />
          <Route path="communities" element={<CommunitiesPage />} />
          <Route path="blog" element={<BlogPage />} />
          <Route path="trigger-links" element={<TriggerLinksPage />} />
          <Route path="affiliates" element={<AffiliatesPage />} />
          <Route path="*" element={<Navigate to="/conversations" replace />} />
        </Route>
      </Routes>
    </AuthProvider>
  )
}
