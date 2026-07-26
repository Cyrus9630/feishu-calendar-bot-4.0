import React from 'react';
import { Outlet } from 'react-router-dom';
import { useAppInfo } from '@lark-apaas/client-toolkit/hooks/useAppInfo';

const Layout = () => {
  const { appName } = useAppInfo();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 flex items-center justify-between px-6 py-3 border-b border-border bg-background">
        <h1 className="text-lg font-semibold tracking-tight">
          {appName || '日程群机器人'}
        </h1>
      </header>
      <main className="p-6">
        <Outlet />
      </main>
    </div>
  );
};

export default Layout;
