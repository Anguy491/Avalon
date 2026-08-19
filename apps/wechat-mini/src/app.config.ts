export default defineAppConfig({
  pages: [
    'pages/index/index',
    'pages/create/index',
    'pages/join/index',
    'pages/scan/index',
  ],
  subPackages: [
    { root: 'room', pages: ['pages/lobby/index'] },
    {
      root: 'game',
      pages: [
        'pages/role/index',
        'pages/game/index',
        'pages/assassination/index',
        'pages/result/index',
      ],
    },
  ],
  window: {
    navigationBarBackgroundColor: '#F6F2E8',
    navigationBarTextStyle: 'black',
    navigationBarTitleText: '曼波阿瓦隆',
    backgroundColor: '#F6F2E8',
    backgroundTextStyle: 'dark',
  },
  networkTimeout: { request: 10000, connectSocket: 10000 },
  lazyCodeLoading: 'requiredComponents',
});
