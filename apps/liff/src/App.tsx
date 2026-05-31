import { Routes, Route, Navigate } from 'react-router-dom';
import Booking from './pages/Booking.js';
import BookingHistory from './pages/BookingHistory.js';
import Event from './pages/Event.js';
import EventConfirm from './pages/EventConfirm.js';
import EventDone from './pages/EventDone.js';
import EventBookings from './pages/EventBookings.js';
import EventList from './pages/EventList.js';

function RootRedirect() {
  const params = new URLSearchParams(window.location.search);
  const page = params.get('page');
  const id = params.get('id');
  if (page === 'events') return <Navigate to="/events" replace />;
  if (page === 'event' && id) return <Navigate to={`/events/${id}`} replace />;
  if (page === 'booking') return <Navigate to="/booking" replace />;
  return <Navigate to="/booking" replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/booking" element={<Booking />} />
      <Route path="/booking/history" element={<BookingHistory />} />
      <Route path="/events" element={<EventList />} />
      <Route path="/events/me" element={<EventBookings />} />
      <Route path="/events/:id/confirm" element={<EventConfirm />} />
      <Route path="/events/:id/done" element={<EventDone />} />
      <Route path="/events/:id" element={<Event />} />
      <Route path="/" element={<RootRedirect />} />
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
