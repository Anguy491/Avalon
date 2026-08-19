export const lightColor = {
  surface: {
    public: '#F6F2E8',
    private: '#171A22',
    blocking: '#292D39',
    card: '#FFFFFF',
  },
  text: { primary: '#171A22', secondary: '#5D6270', inverse: '#FFFFFF' },
  action: {
    primary: '#2E5E55',
    destructive: '#9C2F36',
    selected: '#C99A43',
    disabled: '#A7A9B0',
  },
  result: { success: '#276749', failure: '#9C2F36', pending: '#6B5A2B' },
  focus: { visible: '#1467B3' },
} as const;

export const darkColor = {
  surface: {
    public: '#11151C',
    private: '#080A0F',
    blocking: '#242A35',
    card: '#1B222C',
  },
  text: { primary: '#F7F4EC', secondary: '#BEC7D3', inverse: '#10201D' },
  action: {
    primary: '#8ED5C5',
    destructive: '#FF9EA5',
    selected: '#E6B85C',
    disabled: '#69717D',
  },
  result: { success: '#87D3A5', failure: '#FF9EA5', pending: '#E5C777' },
  focus: { visible: '#74B9FF' },
} as const;

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 } as const;
export const typography = { body: 16, supporting: 13, title: 28 } as const;
export const touchTarget = { minimum: 44 } as const;
