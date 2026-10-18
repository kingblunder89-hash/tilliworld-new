import { Routes, Route, Navigate } from 'react-router-dom'
import PublicLayout from './layouts/PublicLayout.jsx'
import AdminLayout from './layouts/AdminLayout.jsx'
import Home from './pages/Home.jsx'
import Shop from './pages/Shop.jsx'
import Privileges from './pages/Privileges.jsx'
import Product from './pages/Product.jsx'
import Reviews from './pages/Reviews.jsx'
import Account from './pages/Account.jsx'
import Wheel from './pages/Wheel.jsx'
import AdminEconomy from './pages/admin/AdminEconomy.jsx'
import NotFound from './pages/NotFound.jsx'
import Dashboard from './pages/admin/Dashboard.jsx'
import Orders from './pages/admin/Orders.jsx'
import Products from './pages/admin/Products.jsx'
import AdminReviews from './pages/admin/AdminReviews.jsx'
import AdminReports from './pages/admin/AdminReports.jsx'
import AdminAccounts from './pages/admin/AdminAccounts.jsx'
import AdminMutes from './pages/admin/AdminMutes.jsx'
import AdminAudit from './pages/admin/AdminAudit.jsx'

export default function App() {
  return (
    <Routes>
      <Route element={<PublicLayout />}>
        <Route path="/" element={<Home />} />
        <Route path="/shop" element={<Shop />} />
        <Route path="/privileges" element={<Privileges />} />
        <Route path="/shop/:id" element={<Product />} />
        <Route path="/reviews" element={<Reviews />} />
        <Route path="/account" element={<Account />} />
        <Route path="/wheel" element={<Wheel />} />
        <Route path="/catalog" element={<Navigate to="/shop" replace />} />
        <Route path="*" element={<NotFound />} />
      </Route>
      <Route path="/admin" element={<AdminLayout />}>
        <Route index element={<Dashboard />} />
        <Route path="orders" element={<Orders />} />
        <Route path="products" element={<Products />} />
        <Route path="reviews" element={<AdminReviews />} />
        <Route path="reports" element={<AdminReports />} />
        <Route path="accounts" element={<AdminAccounts />} />
        <Route path="players" element={<Navigate to="/admin/accounts" replace />} />
        <Route path="economy" element={<AdminEconomy />} />
        <Route path="mutes" element={<AdminMutes />} />
        <Route path="audit" element={<AdminAudit />} />
      </Route>
    </Routes>
  )
}
