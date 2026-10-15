'use strict';
// What the user must replace before release (showcase has both on)
function generationWarnings({ templateType, featuresConfig }) {
    const on = (key) => templateType === 'showcase' || (featuresConfig != null && featuresConfig[key] === true);
    const warnings = [];
    if (on('ads')) warnings.push('Ads use AdMob test IDs: replace them with your own before release.');
    if (on('purchases')) warnings.push('Purchases use the RevenueCat Test Store key: replace it before release.');
    // Backend is blank only: showcase never has it
    if (templateType === 'blank' && featuresConfig != null && featuresConfig.backend === true) {
        warnings.push('Sign-in needs your Firebase config files (google-services.json, GoogleService-Info.plist) and the server: run ./gradlew :server:runLocal; see the README.');
    }
    return warnings;
}

module.exports = { generationWarnings };
