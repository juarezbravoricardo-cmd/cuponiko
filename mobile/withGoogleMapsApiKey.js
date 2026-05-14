const { withAndroidManifest } = require('expo/config-plugins');

/**
 * Plugin v2: inyecta la Google Maps API key + un marker de verificación.
 * El marker permite verificar si EAS Build realmente ejecutó este plugin.
 */
module.exports = function withGoogleMapsApiKey(config, props) {
  const apiKey = props && props.apiKey;
  if (!apiKey) {
    throw new Error(
      '[withGoogleMapsApiKey] FATAL: apiKey is required. Got props: ' + JSON.stringify(props)
    );
  }

  console.log('[withGoogleMapsApiKey] 🚀 Plugin v2 starting with key prefix=' + apiKey.substring(0, 10));

  return withAndroidManifest(config, (config) => {
    console.log('[withGoogleMapsApiKey] 📝 Inside withAndroidManifest hook');

    const application = config.modResults.manifest.application && config.modResults.manifest.application[0];
    if (!application) {
      throw new Error('[withGoogleMapsApiKey] FATAL: <application> not found in manifest');
    }

    application['meta-data'] = (application['meta-data'] || []).filter(function (item) {
      const name = item.$['android:name'];
      return name !== 'com.google.android.geo.API_KEY' && name !== 'cuponiko.plugin.marker';
    });

    application['meta-data'].push({
      $: {
        'android:name': 'com.google.android.geo.API_KEY',
        'android:value': apiKey,
      },
    });

    application['meta-data'].push({
      $: {
        'android:name': 'cuponiko.plugin.marker',
        'android:value': 'plugin_v2_ran_' + Date.now(),
      },
    });

    console.log('[withGoogleMapsApiKey] ✅ Injected API_KEY + marker into AndroidManifest.xml');

    return config;
  });
};
