import { useState } from "react";
import { X } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

interface AuthModalProps {
  open: boolean;
  onClose: () => void;
}

const AuthModal = ({ open, onClose }: AuthModalProps) => {
  const { signUp, signIn } = useAuth();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const err = mode === "login"
      ? await signIn(username, password)
      : await signUp(username, password);
    setSubmitting(false);
    if (err) {
      setError(err);
    } else {
      setUsername("");
      setPassword("");
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative glass rounded-xl p-6 w-full max-w-sm mx-4 neon-glow-cyan border border-border/50">
        <button
          onClick={onClose}
          className="absolute top-3 right-3 text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        <h2 className="font-pixel text-xs text-primary neon-text-cyan mb-6 text-center">
          {mode === "login" ? "PLAYER LOGIN" : "CREATE ACCOUNT"}
        </h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-[10px] text-muted-foreground font-pixel block mb-1">PSEUDONYM</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              placeholder="Enter username"
              maxLength={20}
              autoComplete="username"
            />
          </div>

          <div>
            <label className="text-[10px] text-muted-foreground font-pixel block mb-1">PASSWORD</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              placeholder="Min 6 characters"
              minLength={6}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
            />
          </div>

          {error && (
            <p className="text-[10px] font-pixel text-destructive text-center">{error}</p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-secondary text-secondary-foreground font-pixel text-[10px] py-3 rounded-lg neon-glow-pink hover:scale-105 active:scale-95 transition-transform disabled:opacity-50"
          >
            {submitting ? "..." : mode === "login" ? "LOG IN" : "CREATE ACCOUNT"}
          </button>
        </form>

        <button
          onClick={() => { setMode(m => m === "login" ? "signup" : "login"); setError(null); }}
          className="w-full text-center text-[10px] text-muted-foreground hover:text-primary transition-colors mt-4 font-pixel"
        >
          {mode === "login" ? "NO ACCOUNT? SIGN UP" : "HAVE AN ACCOUNT? LOG IN"}
        </button>
      </div>
    </div>
  );
};

export default AuthModal;
