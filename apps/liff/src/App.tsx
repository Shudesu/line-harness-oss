import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Booking from './pages/Booking.js';
import BookingHistory from './pages/BookingHistory.js';
import Event from './pages/Event.js';
import EventConfirm from './pages/EventConfirm.js';
import EventDone from './pages/EventDone.js';
import EventBookings from './pages/EventBookings.js';
import Affiliate from './pages/Affiliate.js';
import Webinar from './pages/Webinar.js';
import { legacyQueryTarget } from './legacy-route.js';

function LegacyEntryRedirect() {
  const location = useLocation();
  return <Navigate to={legacyQueryTarget(location.search)} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/booking" element={<Booking />} />
      <Route path="/booking/history" element={<BookingHistory />} />
      <Route path="/events/me" element={<EventBookings />} />
      <Route path="/events/:id/confirm" element={<EventConfirm />} />
      <Route path="/events/:id/done" element={<EventDone />} />
      <Route path="/events/:id" element={<Event />} />
      <Route path="/affiliate" element={<Affiliate />} />
      <Route path="/webinar/:slug" element={<Webinar />} />
      <Route path="/" element={<LegacyEntryRedirect />} />
      <Route
        path="*"
        element={
          <div className="p-8 text-center text-gray-500">
            ページが見つかりませんでした
          </div>
        }
      />
    </Routes>
  );
}
