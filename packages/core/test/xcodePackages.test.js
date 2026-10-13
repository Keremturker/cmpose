const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const { removeSwiftPackage } = require('../src/xcodePackages');

const FIXTURES = path.join(__dirname, 'fixtures', 'monetization');
const read = (name) => fs.readFileSync(path.join(FIXTURES, name), 'utf8');

const GMA_URL = 'https://github.com/googleads/swift-package-manager-google-mobile-ads';
const WITH_ADS = read('project.with-ads.pbxproj');
const WITHOUT_ADS = read('project.without-ads.pbxproj');

// A second package (as Xcode writes it) added to the with-ads project
const OTHER_REF = 'AAAAAAAAAAAAAAAAAAAAAAA1';
const OTHER_PRODUCT = 'AAAAAAAAAAAAAAAAAAAAAAA2';
const OTHER_BUILD_FILE = 'AAAAAAAAAAAAAAAAAAAAAAA3';
const OTHER_REF_COMMENT = '/* XCRemoteSwiftPackageReference "swift-collections" */';

function addSecondPackage(content) {
    const replaceOnce = (text, anchor, replacement) => {
        assert.equal(text.split(anchor).length, 2, `anchor not unique: ${anchor}`);
        return text.replace(anchor, replacement);
    };
    let out = content;
    out = replaceOnce(out, '/* End PBXBuildFile section */',
        `\t\t${OTHER_BUILD_FILE} /* Collections in Frameworks */ = {isa = PBXBuildFile; productRef = ${OTHER_PRODUCT} /* Collections */; };\n/* End PBXBuildFile section */`);
    out = replaceOnce(out, ' /* GoogleMobileAds in Frameworks */,\n',
        ` /* GoogleMobileAds in Frameworks */,\n\t\t\t\t${OTHER_BUILD_FILE} /* Collections in Frameworks */,\n`);
    out = replaceOnce(out, ' /* GoogleMobileAds */,\n\t\t\t);',
        ` /* GoogleMobileAds */,\n\t\t\t\t${OTHER_PRODUCT} /* Collections */,\n\t\t\t);`);
    out = replaceOnce(out, ' /* XCRemoteSwiftPackageReference "swift-package-manager-google-mobile-ads" */,\n',
        ` /* XCRemoteSwiftPackageReference "swift-package-manager-google-mobile-ads" */,\n\t\t\t\t${OTHER_REF} ${OTHER_REF_COMMENT},\n`);
    out = replaceOnce(out, '/* End XCRemoteSwiftPackageReference section */', [
        `\t\t${OTHER_REF} ${OTHER_REF_COMMENT} = {`,
        '\t\t\tisa = XCRemoteSwiftPackageReference;',
        '\t\t\trepositoryURL = "https://github.com/apple/swift-collections";',
        '\t\t\trequirement = {',
        '\t\t\t\tkind = upToNextMajorVersion;',
        '\t\t\t\tminimumVersion = 1.1.0;',
        '\t\t\t};',
        '\t\t};',
        '/* End XCRemoteSwiftPackageReference section */'
    ].join('\n'));
    out = replaceOnce(out, '/* End XCSwiftPackageProductDependency section */', [
        `\t\t${OTHER_PRODUCT} /* Collections */ = {`,
        '\t\t\tisa = XCSwiftPackageProductDependency;',
        `\t\t\tpackage = ${OTHER_REF} ${OTHER_REF_COMMENT};`,
        '\t\t\tproductName = Collections;',
        '\t\t};',
        '/* End XCSwiftPackageProductDependency section */'
    ].join('\n'));
    return out;
}

test('the fixtures differ only by the Google Mobile Ads package', () => {
    assert.notEqual(WITH_ADS, WITHOUT_ADS);
    assert.ok(WITH_ADS.includes('swift-package-manager-google-mobile-ads'));
    assert.ok(!WITHOUT_ADS.includes('swift-package-manager-google-mobile-ads'));
});

test('removeSwiftPackage turns the with-ads project into the without-ads project byte for byte', () => {
    assert.equal(removeSwiftPackage(WITH_ADS, GMA_URL), WITHOUT_ADS);
});

test('removeSwiftPackage matches the repository URL with or without .git', () => {
    assert.equal(removeSwiftPackage(WITH_ADS, `${GMA_URL}.git`), WITHOUT_ADS);
    assert.equal(removeSwiftPackage(WITH_ADS, `${GMA_URL}/`), WITHOUT_ADS);
});

test('removeSwiftPackage leaves the project unchanged when the URL is not there', () => {
    assert.equal(removeSwiftPackage(WITH_ADS, 'https://github.com/apple/swift-collections'), WITH_ADS);
    assert.equal(removeSwiftPackage(WITHOUT_ADS, GMA_URL), WITHOUT_ADS);
    // A URL that only starts like the package's is another package
    assert.equal(removeSwiftPackage(WITH_ADS, `${GMA_URL}-extra`), WITH_ADS);
});

test('removeSwiftPackage is idempotent', () => {
    const once = removeSwiftPackage(WITH_ADS, GMA_URL);
    assert.equal(removeSwiftPackage(once, GMA_URL), once);
});

test('removeSwiftPackage leaves another package intact', () => {
    const twoPackages = addSecondPackage(WITH_ADS);
    const result = removeSwiftPackage(twoPackages, GMA_URL);
    assert.ok(!result.includes('google-mobile-ads'), result);
    assert.ok(!result.includes('GoogleMobileAds'), result);
    assert.ok(result.includes(`\t\t${OTHER_BUILD_FILE} /* Collections in Frameworks */ = {isa = PBXBuildFile; productRef = ${OTHER_PRODUCT} /* Collections */; };`));
    assert.ok(result.includes(`\t\t\tfiles = (\n\t\t\t\t${OTHER_BUILD_FILE} /* Collections in Frameworks */,\n\t\t\t);`));
    assert.ok(result.includes(`\t\t\tpackageProductDependencies = (\n\t\t\t\t${OTHER_PRODUCT} /* Collections */,\n\t\t\t);`));
    assert.ok(result.includes(`\t\t\tpackageReferences = (\n\t\t\t\t${OTHER_REF} ${OTHER_REF_COMMENT},\n\t\t\t);`));
    assert.ok(result.includes('/* Begin XCRemoteSwiftPackageReference section */'));
    assert.ok(result.includes('repositoryURL = "https://github.com/apple/swift-collections";'));
    assert.ok(result.includes(`\t\t\tpackage = ${OTHER_REF} ${OTHER_REF_COMMENT};`));

    // Removing the second package too gives the project without any package
    assert.equal(removeSwiftPackage(result, 'https://github.com/apple/swift-collections.git'), WITHOUT_ADS);
});

// Review M3: no silently unchanged output on a pbxproj written with other line endings or indentation
test('removeSwiftPackage handles a CRLF project and keeps its line endings', () => {
    const crlf = (text) => text.replace(/\n/g, '\r\n');
    assert.equal(removeSwiftPackage(crlf(WITH_ADS), GMA_URL), crlf(WITHOUT_ADS));
    assert.equal(removeSwiftPackage(crlf(WITHOUT_ADS), GMA_URL), crlf(WITHOUT_ADS));
});

test('removeSwiftPackage throws when the package is there but its objects cannot be parsed', () => {
    const spaces = WITH_ADS.replace(/^\t+/gm, (tabs) => '    '.repeat(tabs.length));
    assert.throws(() => removeSwiftPackage(spaces, GMA_URL), /swift-package-manager-google-mobile-ads/);
    // Without the package, an unusual layout is left as it is
    const spacesWithout = WITHOUT_ADS.replace(/^\t+/gm, (tabs) => '    '.repeat(tabs.length));
    assert.equal(removeSwiftPackage(spacesWithout, GMA_URL), spacesWithout);
});
