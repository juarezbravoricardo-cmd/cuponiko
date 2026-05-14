const { withAndroidManifest } = require('expo/config-plugins');

module.exports = function withGoogleMapsApiKey(config, { apiKey }) {
  if (!apiKey) {
    throw new Error('[withGoogleMapsApiKey] apiKey is required');
  }

  return withAndroidManifest(config, (config) => {
    const application = config.modResults.manifest.application[0];

    application['meta-data'] = (application['meta-data'] || []).filter(
      (item) => item.$['android:name'] !== 'com.google.android.geo.API_KEY'
    );

    application['meta-data'].push({
      $: {
        'android:name': 'com.google.android.geo.API_KEY',
        'android:value': apiKey,
      },
    });

    console.log('[withGoogleMapsApiKey] ✅ Injected API key into AndroidManifest.xml');

    return config;
  });
};
