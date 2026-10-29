import { Route } from '@angular/router';

export const appRoutes: Route[] = [
  { path: '', loadComponent: () => import('./home/home').then((m) => m.Home) },
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
