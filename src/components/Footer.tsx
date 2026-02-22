import { Github, Twitter, Gamepad2 } from "lucide-react";

const Footer = () => {
  return (
    <footer className="border-t border-border/50 py-10">
      <div className="container mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Gamepad2 className="w-4 h-4 text-primary" />
          <span className="font-pixel text-[10px] text-muted-foreground">
            Made for Gamers
          </span>
        </div>

        <div className="flex items-center gap-4">
          <a href="#" className="text-muted-foreground hover:text-primary transition-colors" aria-label="Twitter">
            <Twitter className="w-5 h-5" />
          </a>
          <a href="#" className="text-muted-foreground hover:text-primary transition-colors" aria-label="GitHub">
            <Github className="w-5 h-5" />
          </a>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
