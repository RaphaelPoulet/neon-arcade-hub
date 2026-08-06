import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User } from "@supabase/supabase-js";

interface AuthState {
  user: User | null;
  username: string | null;
  isAdmin: boolean;
  loading: boolean;
  signUp: (username: string, password: string) => Promise<string | null>;
  signIn: (username: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be inside AuthProvider");
  return ctx;
};

const LOCAL_ADMIN_KEY = "retro-arcade-local-admin";

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [roleAdmin, setIsAdmin] = useState(false);
  const [localAdmin, setLocalAdmin] = useState(
    () => typeof localStorage !== "undefined" && localStorage.getItem(LOCAL_ADMIN_KEY) === "1"
  );
  const isAdmin = roleAdmin || localAdmin;
  const [loading, setLoading] = useState(true);

  const fetchUsername = async (userId: string) => {
    const { data } = await supabase
      .from("profiles")
      .select("username")
      .eq("user_id", userId)
      .single();
    setUsername(data?.username ?? null);
  };

  const fetchRole = async (userId: string) => {
    const { data } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle();
    setIsAdmin(!!data);
  };

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const u = session?.user ?? null;
      setUser(u);
      if (u) {
        setTimeout(() => { fetchUsername(u.id); fetchRole(u.id); }, 0);
      } else {
        setUsername(null);
        setIsAdmin(false);
      }
      setLoading(false);
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      const u = session?.user ?? null;
      setUser(u);
      if (u) { fetchUsername(u.id); fetchRole(u.id); }
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const fakeEmail = (name: string) => `${name.toLowerCase().replace(/[^a-z0-9]/g, "")}@retro.arcade`;

  const signUp = async (uname: string, password: string): Promise<string | null> => {
    const trimmed = uname.trim();
    if (trimmed.length < 2) return "Username must be at least 2 characters";
    if (trimmed.length > 20) return "Username must be at most 20 characters";
    if (password.length < 6) return "Password must be at least 6 characters";

    // Check if username already taken
    const { data: existing } = await supabase
      .from("profiles")
      .select("id")
      .eq("username", trimmed)
      .maybeSingle();
    if (existing) return "Username already taken";

    const { data, error } = await supabase.auth.signUp({
      email: fakeEmail(trimmed),
      password,
    });
    if (error) return error.message;

    if (data.user) {
      const { error: profileErr } = await supabase.from("profiles").insert({
        user_id: data.user.id,
        username: trimmed,
      });
      if (profileErr) return profileErr.message;
      setUsername(trimmed);
    }
    return null;
  };

  const signIn = async (uname: string, password: string): Promise<string | null> => {
    const trimmed = uname.trim();
    const { error } = await supabase.auth.signInWithPassword({
      email: fakeEmail(trimmed),
      password,
    });
    if (error) return "Invalid username or password";
    return null;
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setUsername(null);
    setIsAdmin(false);
  };

  return (
    <AuthContext.Provider value={{ user, username, isAdmin, loading, signUp, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
};
