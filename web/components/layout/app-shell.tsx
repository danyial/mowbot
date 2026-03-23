"use client";

import { Sidebar } from "./sidebar";
import { MobileNav } from "./mobile-nav";
import { Header } from "./header";
import { RosProvider } from "@/components/shared/ros-provider";
import { Toaster } from "@/components/ui/toaster";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <RosProvider>
      <div className="flex h-screen overflow-hidden">
        <Sidebar />
        <div className="flex flex-col flex-1 overflow-hidden">
          <Header />
          <main className="flex-1 overflow-y-auto pb-16 md:pb-0">
            {children}
          </main>
        </div>
      </div>
      <MobileNav />
      <Toaster />
    </RosProvider>
  );
}
