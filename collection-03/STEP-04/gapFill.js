/**
 * ==============================================================================
 * MAPBIOMAS COLOMBIA - COLLECTION 3 - CROSS-CUTTING: FLOODED
 * STEP 04-3: GAP FILL
 * ==============================================================================
 * @version       1.0
 * @update        March 2026
 * @attribution   MapBiomas Colombia (Fundacion Gaia Amazonas)
 * @description   Fills temporal gaps in the flooded (6) time series using a
 *                bidirectional gap-fill algorithm: forward (1985→2025) then
 *                backward (2025→1985). Before filling, a binary reconstruction
 *                is applied per year using mosaic coverage as the valid-pixel
 *                mask. Years listed in excludeYears bypass the mosaic-based
 *                reconstruction and are restored from the original classification
 *                after gap fill. Year 2025 is also excluded from the
 *                reconstruction loop (handled as a masked band filled via
 *                propagation).
 * @inputs        - Spatially filtered classification (clasificacion-ft/)
 * @outputs       - Earth Engine Asset: gap-filled classification image saved to
 *                  'COLLECTION3/CROSS_CUTTING/FLOODED/clasificacion-ft/'
 * ==============================================================================
 */

// ==============================================================================
// 1. USER PARAMETERS
// ==============================================================================

var param = {
  regionCode:    30208,
  country:       'COLOMBIA',
  previewYear:   2024,
  versionInput:  '2',
  versionOutput: '3',
  excludeYears:  [1985, 1988, 1992, 1993]
};

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

var bandNamesArray = years.map(function(year) { return 'classification_' + year; });
var bandNamesExclude = param.excludeYears.map(function(year) {
  return 'classification_' + year;
});

var inputImageName = 'FLOODED-' + param.country + '-' + param.regionCode + '-' + param.versionInput;
var classification = ee.Image(assets.inputPath + inputImageName);
print('Input image:', classification);
print('Band count (should be 41):', classification.bandNames().length());

// ==============================================================================
// 4. PROCESSING
// ==============================================================================

// Build binary flooded image per year using mosaic coverage as valid-pixel mask.
// Years in excludeYears and year 2025 are skipped (handled separately after fill).
var bandnameReg = classification.bandNames().slice(0, -1);  // exclude last band (2025)
var bands = bandnameReg.getInfo();
if (bands[0] === 'constant') { bands = bands.slice(1); }

var filteredBands = bands.filter(function(band) {
  return bandNamesExclude.indexOf(band) === -1;
});
print('Bands used for reconstruction:', filteredBands);

var classif = ee.Image(0);
filteredBands.forEach(function(bandName) {
  var year = parseInt(bandName.split('_')[1], 10);

  var mosaicBand = mosaics.filter(ee.Filter.eq('year', year))
    .select('swir1_median').mosaic().updateMask(region.rasterMask);

  var nodata = ee.Image(27).updateMask(mosaicBand);

  var newImage = ee.Image(0)
    .updateMask(region.rasterMask)
    .where(nodata.eq(27), 27)
    .where(classification.select(bandName).eq(6), 6);

  var band0 = newImage.updateMask(newImage.unmask().neq(0));

  if (bandName !== 'classification_2025') {
    classif = classif.addBands(band0.rename(bandName));
  }
});

var image = classif.select(filteredBands);

// Fill missing year bands using frequency histogram (handles excludeYears + 2025 as masked)
var bandNames = ee.List(bandNamesArray);

var bandsOccurrence = ee.Dictionary(
  bandNames.cat(image.bandNames()).reduce(ee.Reducer.frequencyHistogram())
);

var bandsDictionary = bandsOccurrence.map(function(key, value) {
  return ee.Image(
    ee.Algorithms.If(
      ee.Number(value).eq(2),
      image.select([key]).byte(),
      ee.Image().rename([key]).byte().updateMask(image.select(0))
    )
  );
});

var imageAllBands = ee.Image(
  bandNames.iterate(
    function(band, img) {
      return ee.Image(img).addBands(bandsDictionary.get(ee.String(band)));
    },
    ee.Image().select()
  )
);

// Apply bidirectional gap fill
var imageFilled = applyGapFill(imageAllBands);

// Restore excluded years from the original classification (bypass gap fill)
var excludedOriginal = ee.Image(classification.select(bandNamesExclude));
imageFilled = imageFilled.addBands(excludedOriginal, bandNamesExclude, true)
  .select(bandNames);

// ==============================================================================
// 5. EXPORT
// ==============================================================================

var outputImageName = 'FLOODED-' + param.country + '-' + param.regionCode + '-' + param.versionOutput;

imageFilled = imageFilled.select(bandNames)
  .set({
    code_region: param.regionCode,
    country:     param.country,
    version:     param.versionOutput,
    process:     'gap fill',
    step:        'S04-3'
  });

print('INPUT: ' + inputImageName, classification);
print('OUTPUT: ' + outputImageName, imageFilled);

Export.image.toAsset({
  image:            imageFilled,
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

Map.addLayer(imageAllBands, vis, 'Original ' + param.previewYear, false);
Map.addLayer(imageFilled,   vis, 'GapFilled ' + param.previewYear);

Map.addLayer(region.vector.style({ color: 'ffffff', fillColor: 'ff000000' }), {}, 'Region');

Map.add(ui.Label('Flooded Col3 - Gap Fill - Region ' + param.regionCode, {
  stretch: 'horizontal', textAlign: 'center', fontWeight: 'bold', fontSize: '10px'
}));

// ==============================================================================
// FUNCTIONS
// ==============================================================================

/**
 * Applies bidirectional gap fill: forward (t0→tn) then backward (tn→t0).
 * Masked pixels are filled from the nearest valid neighbor in time.
 */
function applyGapFill(image) {
  var imageFilledt0tn = ee.Image(image.select([bandNamesArray[0]]));

  bandNamesArray.slice(1).forEach(function(bandName) {
    var current  = image.select(ee.String(bandName));
    var previous = imageFilledt0tn.select(imageFilledt0tn.bandNames().length().subtract(1));
    current = current.unmask(previous);
    imageFilledt0tn = imageFilledt0tn.addBands(current.rename(ee.String(bandName)));
  });

  var bandNamesReversed = bandNamesArray.slice().reverse();
  var imageFilledtnt0 = ee.Image(imageFilledt0tn.select([bandNamesReversed[0]]));

  bandNamesReversed.slice(1).forEach(function(bandName) {
    var current  = imageFilledt0tn.select(ee.String(bandName));
    var previous = imageFilledtnt0.select(imageFilledtnt0.bandNames().length().subtract(1));
    current = current.unmask(previous);
    imageFilledtnt0 = imageFilledtnt0.addBands(current.rename(ee.String(bandName)));
  });

  return imageFilledtnt0.select(ee.List(bandNamesArray));
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
