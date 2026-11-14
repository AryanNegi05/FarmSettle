import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "../contexts/AuthContext";
import Navbar from "../features/shared/Navbar";
import AppRoutes from "./routes";
import { LanguageProvider } from "../i18n";

export default function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <LanguageProvider>
      <AuthProvider>
        <div className="min-h-screen flex flex-col">
          <Navbar />
          <main className="flex-1">
            <AppRoutes />
          </main>
        </div>
      </AuthProvider>
      </LanguageProvider>
    </BrowserRouter>
  );
}
