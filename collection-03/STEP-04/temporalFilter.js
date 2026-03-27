/**
 * ==============================================================================
 * MAPBIOMAS COLOMBIA - COLLECTION 3 - CROSS-CUTTING: FLOODED
 * STEP 04-4: TEMPORAL FILTER
 * ==============================================================================
 * @version       1.0
 * @update        March 2026
 * @attribution   MapBiomas Colombia (Fundacion Gaia Amazonas)
 * @description   Applies temporal consistency windows (3, 4, and 5 years) to
 *                smooth spurious class changes in the flooded (6) time series.
 *                Boundary conditions for the first year (mask3first) and last
 *                year (mask3last) are applied separately. Class values for
 *                first-year and last-year filters are driven by the 'first' and
 *                'last' arrays. Interior years use the 'middle' array.
 *                Optional extra passes for 4-year and 5-year windows are
 *                controlled by optionalFilters.
 * @inputs        - Gap-filled classification (clasificacion-ft/)
 * @outputs       - Earth Engine Asset: temporally filtered classification image
 *                  saved to 'COLLECTION3/CROSS_CUTTING/FLOODED/clasificacion-ft/'
 * ==============================================================================
 */

// ==============================================================================
// 1. USER PARAMETERS
// ==============================================================================

var param = {
  regionCode:     30430,
  country:        'COLOMBIA',
  previewYear:    2023,
  versionInput:   7,
  versionOutput:  8,
  optionalFilters: {
    fourYears: true,
    fiveYears: false
  }
};

var first  = [6];          // Class value for first-year boundary filter
var last   = [27, 27];     // Class value for last-year boundary filter
var middle = [27, 27, 27]; // Class values for interior temporal windows

// ==============================================================================
// 2. IMPORTS & ASSETS
// ==============================================================================

var palettes = require('users/mapbiomas_caribe/public_repo_mbcolombia:mbcolombia-col3/modules/Palettes.js');
var mapbiomasPalette = palettes.get('ColombiaCol3');

var basePath = 'projects/ee-mapbiomasdeveloper/assets/';

var assets = {
  regionsWetland:   basePath + 'PUBLIC_ASSETS/AUXILIARY_DATA/VECTORS/WETLANDS/ClasificacionRegionesInundables2024C2',
  regionesMosaicos: basePath + 'PUBLIC_ASSETS/AUXILIARY_DATA/VECTORS/regiones-mosaicos-2024-buffer-250',
  inputPath:        basePath + 'LULC/COLLECTION3/CROSS_CUTTING/FLOODED/clasificacion-ft/',
  outputAsset:      basePath + 'LULC/COLLECTION3/CROSS_CUTTING/FLOODED/clasificacion-ft/'
};

// ==============================================================================
// 3. INITIALIZATION & DATA LOADING
// ==============================================================================

var region  = getRegion(assets.regionsWetland, param.regionCode);
var mosaics = getMosaic(region.vector);

var years = [
  1985, 1986, 1987, 1988, 1989, 1990, 1991, 1992, 1993, 1994, 1995, 1996,
  1997, 1998, 1999, 2000, 2001, 2002, 2003, 2004, 2005, 2006, 2007, 2008,
  2009, 2010, 2011, 2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019, 2020,
  2021, 2022, 2023, 2024, 2025
];

var bandNames = ee.List(years.map(function(year) {
  return 'classification_' + String(year);
}));

var inputImageName = 'FLOODED-' + param.country + '-' + param.regionCode + '-' + param.versionInput;
var classification = ee.Image(assets.inputPath + inputImageName);
print('Input image:', classification);

// ==============================================================================
// 4. PROCESSING
// ==============================================================================

// Year lists for each window size (interior years only)
var years3 = years.slice(1, years.length - 1);           // 1986–2024
var years4 = years3.slice(0, years3.length - 1);          // 1986–2023
var years5 = years4.slice(0, years4.length - 1);          // 1986–2022

var filtered = classification;
var original = classification;

// Boundary filters
first.forEach(function(classValue) {
  filtered = mask3first(classValue, filtered);
});

last.forEach(function(classValue) {
  filtered = mask3last(classValue, filtered);
});

// Interior temporal windows — main pass
middle.forEach(function(classValue) {
  filtered = window4years(filtered, classValue);
  filtered = window5years(filtered, classValue);
});

middle.forEach(function(classValue) {
  filtered = window3years(filtered, classValue);
});

middle.forEach(function(classValue) {
  filtered = window3years(filtered, classValue);
});

// Optional additional passes
if (param.optionalFilters.fourYears && param.optionalFilters.fiveYears) {
  middle.forEach(function(classValue) {
    filtered = window4years(filtered, classValue);
    filtered = window5years(filtered, classValue);
  });
}

if (param.optionalFilters.fourYears) {
  middle.forEach(function(classValue) {
    filtered = window4years(filtered, classValue);
  });
}

if (param.optionalFilters.fiveYears) {
  middle.forEach(function(classValue) {
    filtered = window5years(filtered, classValue);
  });
}

// ==============================================================================
// 5. EXPORT
// ==============================================================================

var outputImageName = 'FLOODED-' + param.country + '-' + param.regionCode + '-' + param.versionOutput;

filtered = filtered.select(bandNames)
  .set({
    code_region: param.regionCode,
    country:     param.country,
    version:     param.versionOutput.toString(),
    process:     'temporal filter',
    step:        'S04-4'
  });

print('INPUT: ' + inputImageName, classification);
print('OUTPUT: ' + outputImageName, filtered);

Export.image.toAsset({
  image:            filtered,
  description:      outputImageName,
  assetId:          assets.outputAsset + outputImageName,
  pyramidingPolicy: { '.default': 'mode' },
  region:           region.vector.geometry().bounds(),
  scale:            30,
  maxPixels:        1e13
});

// ==============================================================================
// 6. VISUALIZATION
// ==============================================================================

Map.setOptions('SATELLITE');

var vis = {
  bands: ['classification_' + param.previewYear],
  min: 0, max: mapbiomasPalette.length-1, palette: mapbiomasPalette, format: 'png'
};

var mosaicPreview = mosaics.filter(ee.Filter.eq('year', param.previewYear))
  .mosaic().updateMask(region.rasterMask);
Map.addLayer(mosaicPreview, {
  bands: ['swir1_median', 'nir_median', 'red_median'],
  gain: [0.08, 0.06, 0.08], gamma: 0.65
}, 'Mosaic ' + param.previewYear, false);

Map.addLayer(original.unmask(27).updateMask(region.rasterMask), vis, 'ClasOriginal ' + param.previewYear, false);
Map.addLayer(filtered, vis, 'ClasFiltrada ' + param.previewYear);
Map.addLayer(region.vector.style({ color: 'ffffff', fillColor: 'ff000000' }), {}, 'Region');

Map.add(ui.Label('Flooded Col3 - Temporal Filter - Region ' + param.regionCode, {
  stretch: 'horizontal', textAlign: 'center', fontWeight: 'bold', fontSize: '10px'
}));

// ==============================================================================
// FUNCTIONS
// ==============================================================================

/** 3-year window: isolate single-year anomalies flanked by target class. */
function mask3(classValue, ano, image) {
  var prev = 'classification_' + (parseInt(ano, 10) - 1);
  var curr = 'classification_' + parseInt(ano, 10);
  var next = 'classification_' + (parseInt(ano, 10) + 1);

  var mask = image.select(prev).eq(classValue)
    .and(image.select(curr).neq(classValue))
    .and(image.select(next).eq(classValue));

  var changed = image.select(curr).mask(mask.eq(1)).where(mask.eq(1), classValue);
  return image.select(curr).blend(changed);
}

/** 4-year window: isolate two-year anomalies flanked by target class. */
function mask4(classValue, ano, image) {
  var prev = 'classification_' + (parseInt(ano, 10) - 1);
  var curr = 'classification_' + parseInt(ano, 10);
  var next = 'classification_' + (parseInt(ano, 10) + 1);
  var nex2 = 'classification_' + (parseInt(ano, 10) + 2);

  var mask = image.select(prev).eq(classValue)
    .and(image.select(curr).neq(classValue))
    .and(image.select(next).neq(classValue))
    .and(image.select(nex2).eq(classValue));

  var changed  = image.select(curr).mask(mask.eq(1)).where(mask.eq(1), classValue);
  var changed1 = image.select(next).mask(mask.eq(1)).where(mask.eq(1), classValue);
  return image.select(curr).blend(changed).blend(changed1);
}

/** 5-year window: isolate three-year anomalies flanked by target class. */
function mask5(classValue, ano, image) {
  var prev = 'classification_' + (parseInt(ano, 10) - 1);
  var curr = 'classification_' + parseInt(ano, 10);
  var next = 'classification_' + (parseInt(ano, 10) + 1);
  var nex2 = 'classification_' + (parseInt(ano, 10) + 2);
  var nex3 = 'classification_' + (parseInt(ano, 10) + 3);

  var mask = image.select(prev).eq(classValue)
    .and(image.select(curr).neq(classValue))
    .and(image.select(next).neq(classValue))
    .and(image.select(nex2).neq(classValue))
    .and(image.select(nex3).eq(classValue));

  var changed  = image.select(curr).mask(mask.eq(1)).where(mask.eq(1), classValue);
  var changed1 = image.select(next).mask(mask.eq(1)).where(mask.eq(1), classValue);
  var changed2 = image.select(nex2).mask(mask.eq(1)).where(mask.eq(1), classValue);
  return image.select('classification_' + ano).blend(changed).blend(changed1).blend(changed2);
}

/** Apply 3-year window across interior years; preserve first and last. */
function window3years(image, classValue) {
  var img_out = image.select('classification_1985');
  years3.forEach(function(year) {
    img_out = img_out.addBands(mask3(classValue, String(year), image));
  });
  img_out = img_out.addBands(image.select('classification_2025'));
  return img_out;
}

/** Apply 4-year window across interior years; preserve last two. */
function window4years(image, classValue) {
  var img_out = image.select('classification_1985');
  years4.forEach(function(year) {
    img_out = img_out.addBands(mask4(classValue, String(year), image));
  });
  img_out = img_out.addBands(image.select('classification_2024'));
  img_out = img_out.addBands(image.select('classification_2025'));
  return img_out;
}

/** Apply 5-year window across interior years; preserve last three. */
function window5years(image, classValue) {
  var img_out = image.select('classification_1985');
  years5.forEach(function(year) {
    img_out = img_out.addBands(mask5(classValue, String(year), image));
  });
  img_out = img_out.addBands(image.select('classification_2023'));
  img_out = img_out.addBands(image.select('classification_2024'));
  img_out = img_out.addBands(image.select('classification_2025'));
  return img_out;
}

/**
 * First-year boundary filter: if 1985 != class but 1986–1987 == class, set 1985 to class.
 */
function mask3first(classValue, image) {
  var mask = image.select('classification_1985').neq(classValue)
    .and(image.select('classification_1986').eq(classValue))
    .and(image.select('classification_1987').eq(classValue));

  var changed = image.select('classification_1985').mask(mask.eq(1)).where(mask.eq(1), classValue);
  var img_out = image.select('classification_1985').blend(changed);
  var remaining = image.bandNames().remove('classification_1985');
  return img_out.addBands(image.select(remaining));
}

/**
 * Last-year boundary filter: if 2023–2024 == class but 2025 != class, set 2025 to class.
 */
function mask3last(classValue, image) {
  var mask = image.select('classification_2023').eq(classValue)
    .and(image.select('classification_2024').eq(classValue))
    .and(image.select('classification_2025').neq(classValue));

  var changed = image.select('classification_2025').mask(mask.eq(1)).where(mask.eq(1), classValue);
  var img_out = image.select('classification_2025').blend(changed);
  var remaining = image.bandNames().remove('classification_2025');
  return image.select(remaining).addBands(img_out);
}

/**
 * Generates the region of interest vector and raster mask.
 */
function getRegion(regionPath, regionCode) {
  var regionData = ee.FeatureCollection(regionPath)
    .filter(ee.Filter.eq('id_regionC', regionCode));
  var regionMask = regionData
    .map(function(item) { return item.set('version', 1); })
    .reduceToImage(['version'], ee.Reducer.first());
  return { vector: regionData, rasterMask: regionMask };
}

/**
 * Retrieves and clips image mosaics to the region of interest.
 */
function getMosaic(regionObj) {
  var mosaicsColPaths = [
    'projects/mapbiomas-colombia/assets/MOSAICOS/mosaics-3-ct',
    'projects/mapbiomas-raisg/MOSAICOS/mosaics-6',
    'projects/mapbiomas-colombia/assets/MOSAICOS/mosaics-3',
    'projects/mapbiomas-raisg/MOSAICOS/col-amazonia-pathrow'
  ];

  var mergedMosaics = ee.ImageCollection(mosaicsColPaths[0])
    .merge(ee.ImageCollection(mosaicsColPaths[1]))
    .merge(ee.ImageCollection(mosaicsColPaths[2]))
    .merge(ee.ImageCollection(mosaicsColPaths[3]))
    .filter(ee.Filter.eq('country', 'COLOMBIA'));

  var regionMosaics = ee.FeatureCollection(assets.regionesMosaicos);

  return mergedMosaics.filterBounds(regionObj).map(function(img) {
    return img
      .clip(regionMosaics.filter(ee.Filter.eq('id_region', img.get('region_code'))))
      .clip(regionObj);
  });
}
