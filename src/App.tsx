import { Routes, Route } from "react-router-dom";
import { Layout } from "./components/Layout";
import { Home } from "./pages/Home";
import { BookEditor } from "./pages/BookEditor";
import { CoverDesigner } from "./pages/CoverDesigner";
import { Settings } from "./pages/Settings";

function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="settings" element={<Settings />} />
      </Route>
      {/* Full-page editors without sidebar */}
      <Route path="book/:bookId" element={<BookEditor />} />
      <Route path="book/:bookId/cover" element={<CoverDesigner />} />
    </Routes>
  );
}

export default App;
