/**
 * ==============================================================================
 * MAPBIOMAS COLOMBIA - COLLECTION 3 - CROSS-CUTTING: FLOODED
 * STEP 02: TRAINING SAMPLE GENERATION
 * ==============================================================================
 * @version       1.0
 * @update        March 2026
 * @attribution   MapBiomas Colombia (Fundacion Gaia Amazonas)
 * @description   Generates training samples for the flooded Random Forest
 *                classifier. Derives stable pixels from the Collection 2
 *                integration image (class 6 = flooded, class 5 = mangrove
 *                treated as flooded), applies polygon-based remapping to correct
 *                reference labels, performs stratified sampling across all
 *                years, and exports a single merged FeatureCollection.
 * @inputs        - MapBiomas Colombia Collection 2 integration image
 *                - Classification mask ROI (STEP1_REGIONS/classification_mask/)
 * @outputs       - Earth Engine Asset: training samples FeatureCollection
 *                  saved to 'FLOODED/SAMPLES/'
 * @geom_struct   REMAP GEOMETRIES (from_27_to_6, from_6_to_27, eliminate_samples_):
 *                Each item must be a FeatureCollection imported in the Code Editor.
 *                Each feature must contain:
 *                - 'original': Comma-separated source class IDs
 *                - 'new':      Comma-separated target class IDs
 *                ROI INCLUSION / EXCLUSION (inc_roi, exc_roi):
 *                FeatureCollections imported in the Code Editor.
 *                Features must have a 'value' property = 1.
 * ==============================================================================
 */

// ==============================================================================
// 1. USER PARAMETERS
// ==============================================================================
var param = {
  regionCode:    30430,
  country:       'COLOMBIA',
  previewYears:  [2023],
  samples:       [100, 200], // [non-Flooded, Flooded]
  versionOutput: '1',
  remapPolygons: [
    typeof from_27_to_6       !== 'undefined' ? from_27_to_6       : null,
    typeof from_6_to_27       !== 'undefined' ? from_6_to_27       : null,
    typeof eliminate_samples_ !== 'undefined' ? eliminate_samples_ : null
  ].filter(function(r) { return r !== null; }),
  classificationArea: {
    versionROI: '1',
    inclusion:  typeof inc_roi !== 'undefined' ? inc_roi : ee.FeatureCollection([]),
    exclusion:  typeof exc_roi !== 'undefined' ? exc_roi : ee.FeatureCollection([])
  }
};

var years = [
  1985, 1986, 1987, 1988, 1989, 1990, 1991, 1992,
  1993, 1994, 1995, 1996, 1997, 1998, 1999, 2000,
  2001, 2002, 2003, 2004, 2005, 2006, 2007, 2008,
  2009, 2010, 2011, 2012, 2013, 2014, 2015, 2016,
  2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024,
  2025
];

var featureSpace = [
  'blue_median',   'cai_median',    'cloud_median',
  'evi2_amp',      'evi2_median',   'evi2_stdDev',
  'gcvi_median',   'green_median',  'green_min',
  'gv_median',     'gv_stdDev',     'gvs_median',
  'gvs_stdDev',    'hallcover_median',
  'ndfi_amp',      'ndfi_median',   'ndfi_stdDev',
  'ndvi_amp',      'ndvi_median',   'ndvi_stdDev',
  'nir_median',    'nir_min',       'nir_stdDev',
  'npv_median',    'npv_stdDev',    'pri_median',
  'red_median',    'red_min',       'savi_median',
  'savi_stdDev',   'sefi_median',   'sefi_stdDev',
  'shade_median',  'soil_amp',      'soil_median',
  'soil_stdDev',   'swir1_median',  'swir1_min',
  'swir2_median',  'swir2_min',     'wefi_amp',
  'wefi_stdDev'
];

// ==============================================================================
// 2. IMPORTS & ASSETS
// ==============================================================================

var palettes = require('users/mapbiomas_caribe/public_repo_mbcolombia:mbcolombia-col3/modules/Palettes.js');
var mapbiomasPalette = palettes.get('ColombiaCol3');

var basePath = 'projects/ee-mapbiomasdeveloper/assets/';

var assets = {
  regions:          basePath + 'PUBLIC_ASSETS/AUXILIARY_DATA/VECTORS/WETLANDS/ClasificacionRegionesInundables2024C2',
  regionesMosaicos: basePath + 'PUBLIC_ASSETS/AUXILIARY_DATA/VECTORS/regiones-mosaicos-2024-buffer-250',
  col2Integration:  'projects/mapbiomas-public/assets/colombia/collection2/mapbiomas_colombia_collection2_integration_v1',
  maskROI:          basePath + 'LULC/COLLECTION3/CROSS_CUTTING/FLOODED/STEP1_REGIONS/classification_mask/FLOODED-ROI-' +
                    param.country + '-' + param.regionCode + '-' + param.classificationArea.versionROI,
  outputAsset:      basePath + 'LULC/COLLECTION3/CROSS_CUTTING/FLOODED/SAMPLES/'
};

// ==============================================================================
// 3. INITIALIZATION & DATA LOADING
// ==============================================================================

var region = getRegion(assets.regions, param.regionCode);

var mosaics = getMosaic(region.vector).map(tasseledCap);

print('Mosaics:', mosaics.limit(10));

var col2Integration = ee.Image(assets.col2Integration).updateMask(region.rasterMask);
print('Collection 2 Integration:', col2Integration);

var classes      = ee.List.sequence(1, 50).getInfo();
var stablePixels = getStablePixels(col2Integration, classes);
Map.addLayer(stablePixels,{min:0,max:mapbiomasPalette.length-1,palette:mapbiomasPalette},'stablePixels')
// ==============================================================================
// 4. SAMPLE PREPARATION
// ==============================================================================

var classArea = ee.Image(assets.maskROI).updateMask(region.rasterMask);
classArea = applyIncludeExclude(
  classArea,
  param.classificationArea.inclusion,
  param.classificationArea.exclusion
);

var floodedPixels = stablePixels.selfMask().eq(6);
var mangrovePixels = stablePixels.selfMask().eq(5);

// Class 5 (mangrove) pixels are treated as flooded (class 6) in the reference
var stableReference = stablePixels
  .where(classArea.eq(1), 27)
  .where(floodedPixels.eq(1), 6)
  .where(mangrovePixels.eq(1), 6)
  .updateMask(classArea)
  .rename('reference');

if (param.remapPolygons.length > 0) {
  stableReference = remapWithPolygons(stableReference, param.remapPolygons);
}
Map.addLayer(stableReference,{min:0,max:mapbiomasPalette.length-1,palette:mapbiomasPalette},'stableReference')
stableReference = stableReference.updateMask(region.rasterMask);

// Stratified sample points (geometry-only, values extracted per year)
var points = stableReference
  .addBands(ee.Image.pixelLonLat())
  .stratifiedSample({
    numPoints:   0,
    classBand:   'reference',
    region:      region.vector.geometry().bounds(),
    scale:       60,
    seed:        123,
    geometries:  true,
    dropNulls:   true,
    classValues: [6, 27],
    classPoints: [param.samples[1], param.samples[0]],
    tileScale:   16
  });


// ==============================================================================
// 5. SAMPLE EXTRACTION
// ==============================================================================

Map.setOptions('SATELLITE');

var samplesList = ee.List([]);

years.forEach(function(year) {
  var mosaic = mosaics
    .filter(ee.Filter.eq('year', year))
    .median()
    .updateMask(region.rasterMask);

  var mosaicSel = mosaic
    .updateMask(mosaic.select('blue_median').gte(0))
    .select(featureSpace)
    .updateMask(classArea);

  var training = getSamples(stableReference, mosaicSel, points);

  
  samplesList = samplesList.add(
    training.map(function(feature) { return feature.set('year', year); })
  );

  if (param.previewYears.indexOf(year) > -1) {
    Map.addLayer(
      mosaic,
      { bands: ['swir1_median', 'nir_median', 'red_median'], gain: [0.08, 0.06, 0.2] },
      'Mosaic Red ' + year, false
    );
    Map.addLayer(
      mosaic,
      { bands: ['wetness', 'greeness', 'brightness'], min: -1800, max: 3800 },
      'Tasseled Cap ' + year, false
    );
    Map.addLayer(
      mosaic,
      { bands: ['brightness', 'greeness', 'wetness'], min: -2545, max: 5167 },
      'Tasseled Cap - river banks ' + year, false
    );
  }
});

var samplesFC = ee.FeatureCollection(samplesList).flatten();

// ==============================================================================
// 6. EXPORT
// ==============================================================================

var outputName = 'samples-FLOODED-' + param.country + '-' + param.regionCode + '-' + param.versionOutput;

Export.table.toAsset(samplesFC, outputName, assets.outputAsset + outputName);

// ==============================================================================
// 7. VISUALIZATION
// ==============================================================================

// Map.centerObject(region.vector, 10);

Map.addLayer(classArea, { palette: ['fcff00'] }, 'Mask (ROI)', false);
Map.addLayer(
  stableReference,
  { min: 0, max: mapbiomasPalette.length - 1, palette: mapbiomasPalette },
  'Stable pixels inside mask', false
);

var trainingPointsColor = points.map(function(feature) {
  var c = feature.get('reference');
  return feature.set({
    style: {
      color:     ee.List(mapbiomasPalette).get(c),
      pointSize: 2
    }
  });
});
Map.addLayer(trainingPointsColor.style({ styleProperty: 'style' }), {}, 'Training samples', true);
Map.addLayer(region.vector, {}, 'Region — ' + param.regionCode, false);

Map.add(ui.Label(
  'Flooded (Class 6) — Step 2 — Region ' + param.regionCode,
  { stretch: 'horizontal', textAlign: 'center', fontWeight: 'bold', fontSize: '10px' }
));

// ==============================================================================
// HELPER FUNCTIONS
// ==============================================================================

/**
 * Generates stable pixels: pixels classified as the same class in all years.
 */
function getStablePixels(image, classes) {
  var bandNames = image.bandNames();
  var images    = [];

  classes.forEach(function(classId) {
    var previousBand = image.select([bandNames.get(0)]).eq(classId);

    var singleClass = ee.Image(
      bandNames.slice(1).iterate(
        function(bandName, previousBand) {
          return image.select(ee.String(bandName)).eq(classId).multiply(previousBand);
        },
        previousBand
      )
    );

    singleClass = singleClass.updateMask(singleClass.eq(1)).multiply(classId);
    images.push(singleClass);
  });

  var allStable = ee.Image();
  images.forEach(function(img) { allStable = allStable.blend(img); });
  return allStable;
}

/**
 * Extracts training samples by sampling reference bands from the mosaic.
 */
function getSamples(reference, mosaic, points) {
  return reference
    .addBands(mosaic)
    .sampleRegions({
      collection: points,
      properties: ['reference'],
      scale:       30,
      geometries:  true,
      tileScale:   16
    });
}

/**
 * Remaps class values within polygon-defined areas.
 * Features must have 'original' and 'new' properties (comma-separated class IDs).
 */
function remapWithPolygons(image, polygons) {
  polygons.forEach(function(polygon) {
    var excluded = polygon.map(function(layer) {
      var area = image.clip(layer);
      var from = ee.String(layer.get('original')).split(',')
        .map(function(item) { return ee.Number.parse(item); });
      var to   = ee.String(layer.get('new')).split(',')
        .map(function(item) { return ee.Number.parse(item); });
      return area.remap(from, to);
    });
    excluded  = ee.ImageCollection(excluded).mosaic();
    image     = excluded.unmask(image).rename('reference');
    image     = image.mask(image.neq(0));
  });
  return image;
}

/**
 * Applies inclusion and exclusion polygon edits to a binary mask.
 */
function applyIncludeExclude(mask, inclu, exclu) {
  var inclusionRegions = ee.FeatureCollection(inclu)
    .reduceToImage(['value'], ee.Reducer.first()).eq(1);
  var exclusionRegions = ee.FeatureCollection(exclu)
    .reduceToImage(['value'], ee.Reducer.first()).eq(1);
  mask = mask.where(exclusionRegions.eq(1), 0).selfMask();
  mask = ee.Image(0).where(mask.eq(1), 1).where(inclusionRegions.eq(1), 1).selfMask();
  return mask;
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

/**
 * Computes Tasseled Cap brightness, greeness, and wetness.
 * Coefficients differ between Landsat 8 and Landsat 5/7.
 */
function tasseledCap(image) {
  var sensor = ee.String(image.get('satellite')).slice(1);

  var landsatBands = {
    BLUE:  image.select('blue_median'),
    GREEN: image.select('green_median'),
    RED:   image.select('red_median'),
    NIR:   image.select('nir_median'),
    SWIR1: image.select('swir1_median'),
    SWIR2: image.select('swir2_median')
  };

  var brightness = ee.Image(ee.Algorithms.If(
    ee.Algorithms.IsEqual(sensor, '8'),
    image.expression('(BLUE*0.3029)+(GREEN*0.2786)+(RED*0.4733)+(NIR*0.5599)+(SWIR1*0.508)+(SWIR2*0.1872)', landsatBands),
    image.expression('(BLUE*0.3037)+(GREEN*0.2793)+(RED*0.4743)+(NIR*0.5585)+(SWIR1*0.5082)+(SWIR2*0.1863)', landsatBands)
  )).rename('brightness').toInt16();

  var greeness = ee.Image(ee.Algorithms.If(
    ee.Algorithms.IsEqual(sensor, '8'),
    image.expression('-(BLUE*0.2941)-(GREEN*0.243)-(RED*0.5424)+(NIR*0.7276)+(SWIR1*0.0713)-(SWIR2*0.1608)', landsatBands),
    image.expression('-(BLUE*0.2848)-(GREEN*0.2435)-(RED*0.5436)+(NIR*0.7243)+(SWIR1*0.0840)-(SWIR2*0.1800)', landsatBands)
  )).rename('greeness').toInt16();

  var wetness = ee.Image(ee.Algorithms.If(
    ee.Algorithms.IsEqual(sensor, '8'),
    image.expression('(BLUE*0.1511)+(GREEN*0.1973)+(RED*0.3283)+(NIR*0.3407)-(SWIR1*0.7117)-(SWIR2*0.4559)', landsatBands),
    image.expression('-(BLUE*0.1509)+(GREEN*0.1973)+(RED*0.3279)+(NIR*0.3406)-(SWIR1*0.7112)-(SWIR2*0.4572)', landsatBands)
  )).rename('wetness').toInt16();

  return image.addBands(brightness).addBands(greeness).addBands(wetness);
}
