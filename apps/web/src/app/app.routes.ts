import { Route } from '@angular/router';

export const appRoutes: Route[] = [
  { path: '', loadComponent: () => import('./home/home').then((m) => m.Home) },
  {
    path: 'assets/:id',
    loadComponent: () =>
      import('./asset-detail/asset-detail').then((m) => m.AssetDetailPage),
  },
  {
    path: 'trash',
    loadComponent: () => import('./trash/trash').then((m) => m.TrashPage),
  },
  {
    path: 'login-failed',
    loadComponent: () =>
      import('./auth/login-failed').then((m) => m.LoginFailed),
  },
  {
    path: 'emergency',
    loadComponent: () =>
      import('./auth/emergency-login').then((m) => m.EmergencyLogin),
  },
  { path: '**', redirectTo: '' },
];
