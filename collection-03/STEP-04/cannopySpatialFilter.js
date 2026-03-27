/**
 * ==============================================================================
 * MAPBIOMAS COLOMBIA - COLLECTION 3 - CROSS-CUTTING: FLOODED
 * STEP 04: CANOPY SPATIAL FILTER
 * ==============================================================================
 * @version       1.0
 * @update        March 2026
 * @attribution   MapBiomas Colombia (Fundacion Gaia Amazonas)
 * @description   Applies a canopy-height mask followed by a spatial connectivity
 *                filter. First, flooded pixels (6) where the ETH Global Canopy
 *                Height (2020) is greater than or equal to canopyThreshold are
 *                reclassified to 27 (non-flooded), removing tall-canopy false
 *                positives. Then a connectedPixelCount + focal_mode spatial
 *                filter removes isolated small groups (< minConnectedPixels).
 *                Missing year bands are filled with 27 before filtering using
 *                a remap([0,6],[27,6],27).
 * @inputs        - Frequency-filtered classification (clasificacion-ft/)
 * @outputs       - Earth Engine Asset: canopy+spatially filtered classification
 *                  image saved to 'COLLECTION3/CROSS_CUTTING/FLOODED/clasificacion-ft/'
 * ==============================================================================
 */

// ==============================================================================
// 1. USER PARAMETERS
// ==============================================================================

var param = {
  regionCode:         30430,
  country:            'COLOMBIA',
  inputCollection:    'clasificacion-ft',
  minConnectedPixels: 10,
  eightConnected:     true,
  canopyThreshold:    11,
  previewYears:       [2023],
  versionInput:       8,
  versionOutput:      9
};

var classId = 6;

// ==============================================================================
// 2. IMPORTS & ASSETS
// ==============================================================================

var palettes = require('users/mapbiomas_caribe/public_repo_mbcolombia:mbcolombia-col3/modules/Palettes.js');
var mapbiomasPalette = palettes.get('ColombiaCol3');

var basePath = 'projects/ee-mapbiomasdeveloper/assets/';

var assets = {
  regionsWetland:   basePath + 'PUBLIC_ASSETS/AUXILIARY_DATA/VECTORS/WETLANDS/ClasificacionRegionesInundables2024C2',
  regionesMosaicos: basePath + 'PUBLIC_ASSETS/AUXILIARY_DATA/VECTORS/regiones-mosaicos-2024-buffer-250',
  canopyHeight:     'users/nlang/ETH_GlobalCanopyHeight_2020_10m_v1',
  inputPath:        basePath + 'LULC/COLLECTION3/CROSS_CUTTING/FLOODED/' + param.inputCollection + '/',
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

// Strip constant band if present; mask zero-value pixels
var bandnameReg = classification.bandNames();
var bands = bandnameReg.getInfo();
if (bands[0] === 'constant') {
  bands = bands.slice(1);
}

var classif = ee.Image();
bands.forEach(function(bandName) {
  var imagey = classification.select(bandName);
  var band0  = imagey.updateMask(imagey.unmask().neq(0));
  classif = classif.addBands(band0.rename(bandName));
});

var image = classif.select(bands).unmask().updateMask(region.rasterMask);

// Fill missing year bands with 27 (non-flooded) using frequency histogram
var bandsOccurrence = ee.Dictionary(
  bandNames.cat(image.bandNames()).reduce(ee.Reducer.frequencyHistogram())
);

var bandsDictionary = bandsOccurrence.map(function(key, value) {
  return ee.Image(
    ee.Algorithms.If(
      ee.Number(value).eq(2),
      image.select([key]),
      ee.Image(27).rename([key])
    )
  ).byte();
});

var allBandsImage = ee.Image(
  bandNames.iterate(
    function(band, img) {
      var newBand = ee.Image(bandsDictionary.get(ee.String(band)))
        .remap([0, classId], [27, classId], 27)
        .rename(ee.String(band));
      return ee.Image(img).addBands(newBand).updateMask(region.rasterMask);
    },
    ee.Image().select()
  )
);

// Save pre-canopy-mask image for visualization
var allBandsPreCanopy = allBandsImage;

// Apply canopy-height mask: flooded pixels under tall canopy → reclassified to 27
var canopyHeight = ee.Image(assets.canopyHeight);
allBandsImage = allBandsImage.where(
  canopyHeight.gte(param.canopyThreshold).and(allBandsImage.eq(classId)),
  27
);

// Compute connected pixel counts for spatial filtering
var imageWithCounts = allBandsImage.addBands(
  allBandsImage.connectedPixelCount(100, param.eightConnected)
    .rename(bandNames.map(function(band) {
      return ee.String(band).cat('_connected');
    }))
);

var filteredImage = ee.Image(0).updateMask(region.rasterMask);

years.forEach(function(year) {
  var bandName  = 'classification_' + year;
  var bandConn  = bandName + '_connected';
  var imageBand = imageWithCounts.select(bandName);
  var connected = imageWithCounts.select(bandConn);

  var moda = imageBand
    .focal_mode(1, 'square', 'pixels')
    .mask(connected.lte(param.minConnectedPixels));

  var classOut = imageBand.blend(moda);
  filteredImage = filteredImage.addBands(classOut);
});

filteredImage = filteredImage.select(bandNames).updateMask(region.rasterMask);

var reprojected = filteredImage.reproject({ crs: 'EPSG:4326', scale: 30 });

// ==============================================================================
// 5. EXPORT
// ==============================================================================

var outputImageName = 'FLOODED-' + param.country + '-' + param.regionCode + '-' + param.versionOutput;

filteredImage = filteredImage.select(bandNames)
  .set({
    code_region: param.regionCode,
    country:     param.country,
    version:     param.versionOutput.toString(),
    process:     'canopy spatial filter',
    step:        'S04'
  });

print('INPUT: ' + inputImageName, classification);
print('OUTPUT: ' + outputImageName, filteredImage);

Export.image.toAsset({
  image:            filteredImage,
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

param.previewYears.forEach(function(year) {
  var selector = 'classification_' + year;
  var vis = {
    bands: [selector], min: 0, max: mapbiomasPalette.length - 1,
    palette: mapbiomasPalette, format: 'png'
  };

  var mosaicYear = mosaics.filter(ee.Filter.eq('year', year))
    .median().clip(region.vector);
  Map.addLayer(mosaicYear, {
    bands: ['swir1_median', 'nir_median', 'red_median'],
    gain: [0.08, 0.06, 0.2], gamma: 0.65
  }, 'Mosaic ' + year, false);

  Map.addLayer(allBandsPreCanopy.select(selector), vis, 'ClasOriginal ' + year, false);
  Map.addLayer(allBandsImage.select(selector),     vis, 'ClasCanopy '   + year, false);
  Map.addLayer(reprojected.select(selector),       vis, 'ClasFiltrada ' + year);
});

Map.addLayer(
  canopyHeight.lte(param.canopyThreshold).selfMask().clip(region.vector),
  { palette: ['green'] },
  'Canopy mask (<= ' + param.canopyThreshold + 'm)', false
);
Map.addLayer(
  canopyHeight.clip(region.vector),
  { min: 1, max: 35, palette: ['ff0000', 'ff9e0f', 'fcff0c', '4fff13', '08cc16'] },
  'Canopy height', false
);
Map.addLayer(region.vector.style({ color: 'ffffff', fillColor: 'ff000000' }), {}, 'Region');

Map.add(ui.Label('Flooded Col3 - Canopy Spatial Filter - Region ' + param.regionCode, {
  stretch: 'horizontal', textAlign: 'center', fontWeight: 'bold', fontSize: '10px'
}));

// ==============================================================================
// FUNCTIONS
// ==============================================================================

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
