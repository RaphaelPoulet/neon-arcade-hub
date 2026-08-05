import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import Index from "./pages/Index";
import GamePage from "./pages/GamePage";
import NeonSnakePage from "./pages/NeonSnakePage";
import VoidInvadersPage from "./pages/VoidInvadersPage";
import PhantomMazePage from "./pages/CyberManPage";
import SuperKartPage from "./pages/SuperKartPage";
import NeonPinballPage from "./pages/NeonPinballPage";
import Leaderboard from "./pages/Leaderboard";
import Admin from "./pages/Admin";
import MusicPlayer from "./components/MusicPlayer";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/game/neon-snake" element={<NeonSnakePage />} />
          <Route path="/game/void-invaders" element={<VoidInvadersPage />} />
          <Route path="/game/phantom-maze" element={<PhantomMazePage />} />
          <Route path="/game/super-kart" element={<SuperKartPage />} />
          <Route path="/game/neon-pinball" element={<NeonPinballPage />} />
          <Route path="/game/:slug" element={<GamePage />} />
          <Route path="/leaderboard" element={<Leaderboard />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
