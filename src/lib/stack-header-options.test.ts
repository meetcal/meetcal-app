import { SLIDE_IN_FROM_RIGHT, stackHeaderOptions } from './stack-header-options';

describe('stackHeaderOptions', () => {
  it('colors the header from the header tokens and keeps the back button minimal', () => {
    const options = stackHeaderOptions({ headerTitle: '#111111', headerBackground: '#222222', text: '#333333' });

    expect(options).toMatchObject({
      headerShown: true,
      headerBackButtonDisplayMode: 'minimal',
      headerTitleStyle: { color: '#111111' },
      headerStyle: { backgroundColor: '#222222' },
      headerTintColor: '#333333',
      headerShadowVisible: false,
    });
  });

  it('slides a pushed screen in from the right with a back swipe', () => {
    expect(SLIDE_IN_FROM_RIGHT).toEqual({ gestureEnabled: true, gestureDirection: 'horizontal', animation: 'slide_from_right' });
  });
});
