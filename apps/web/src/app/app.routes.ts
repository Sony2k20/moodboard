import { Route } from '@angular/router';

export const appRoutes: Route[] = [
  { path: '', loadComponent: () => import('./home/home').then((m) => m.Home) },
  {
    path: 'components/new',
    loadComponent: () =>
      import('./components/new-component').then((m) => m.NewComponentPage),
  },
  {
    path: 'boards',
    loadComponent: () => import('./boards/boards-page').then((m) => m.BoardsPage),
  },
  {
    path: 'boards/:id',
    loadComponent: () => import('./boards/board-page').then((m) => m.BoardPage),
  },
  {
    path: 'assets/:id',
    loadComponent: () =>
      import('./asset-detail/asset-detail').then((m) => m.AssetDetailPage),
  },
  {
    path: 'review',
    loadComponent: () => import('./review/review').then((m) => m.ReviewPage),
  },
  {
    path: 'vocabulary',
    loadComponent: () =>
      import('./vocabulary/vocabulary-page').then((m) => m.VocabularyPage),
  },
  {
    path: 'analysis',
    loadComponent: () => import('./analysis/analysis-page').then((m) => m.AnalysisPage),
  },
  {
    path: 'trash',
    loadComponent: () => import('./trash/trash').then((m) => m.TrashPage),
  },
  {
    path: 'tokens',
    loadComponent: () => import('./tokens/tokens').then((m) => m.TokensPage),
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
