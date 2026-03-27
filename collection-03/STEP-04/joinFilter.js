/**
 * ==============================================================================
 * MAPBIOMAS COLOMBIA - COLLECTION 3 - CROSS-CUTTING: FLOODED
 * STEP 04-1: JOIN FILTER
 * ==============================================================================
 * @version       1.0
 * @update        March 2026
 * @attribution   MapBiomas Colombia (Fundacion Gaia Amazonas)
 * @description   Joins the Collection 2 flooded base classification (binarized
 *                to 6 / 27) with new years from the Collection 3 RF
 *                classification. The Col2 base provides the full 1985–2023
 *                time series; Col3 bands are overlaid for joinYears (typically
 *                2024–2025). Optional polygon-based year-range overrides
 *                (remapPolygons) replace Col2 bands with Col3 values within
 *                user-defined geometries and year spans.
 * @inputs        - Col2 flooded integration image (FLOODED_V1)
 *                - Col3 RF classification (clasificacion/)
 * @outputs       - Earth Engine Asset: joined classification image saved to
 *                  'COLLECTION3/CROSS_CUTTING/FLOODED/clasificacion-ft/'
 * @geom_struct   REMAP POLYGONS (e.g. incluir_24_2018_2019):
 *                Each item must be a FeatureCollection imported in the Code
 *                Editor. Each feature must contain 't0' and 't1' properties
 *                (integer years) defining the override year range.
 * ==============================================================================
 */

// ==============================================================================
// 1. USER PARAMETERS
// ==============================================================================

var param = {
  regionCode:    30430,
  country:       'COLOMBIA',
  previewYears:  [2023],
  versionInput:  '1',   // Col3 RF classification version
  versionOutput: '11',
  joinYears:     [2024, 2025],
  remapPolygons: [
    typeof incluir_24_2018_2019 !== 'undefined' ? incluir_24_2018_2019 : null
  ].filter(function(r) { return r !== null; })
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
  col2Flooded:      'projects/mapbiomas-raisg/MAPBIOMAS-COLOMBIA/COLECCION2/TRANSVERSALES/INUNDABLE/INTEGRACION/FLOODED_V1',
  inputPath:        basePath + 'LULC/COLLECTION3/CROSS_CUTTING/FLOODED/clasificacion',
  outputAsset:      basePath + 'LULC/COLLECTION3/CROSS_CUTTING/FLOODED/clasificacion-ft/'
};

// ==============================================================================
// 3. INITIALIZATION & DATA LOADING
// ==============================================================================

var region  = getRegion(assets.regionsWetland, param.regionCode);
var mosaics = getMosaic(region.vector);

// Col2 base: binarize to 6 (flooded) / 27 (non-flooded)
var col2Base = ee.Image(assets.col2Flooded);
col2Base = col2Base
  .where(col2Base.eq(6),  6)
  .where(col2Base.neq(6), 27)
  .updateMask(region.rasterMask);
print('Col2 base (binarized):', col2Base);

// Col3 RF classification
var col3Classification = ee.ImageCollection(assets.inputPath)
  .filter(ee.Filter.eq('code_region', param.regionCode))
  .filter(ee.Filter.eq('version', param.versionInput))
  .mosaic();
print('col3Classification',col3Classification)
// Select only joinYears bands from Col3
var joinBandNames = param.joinYears.map(function(year) {
  return 'classification_' + year;
});
var col3JoinBands = col3Classification.select(joinBandNames);
print('Col3 join bands:', col3JoinBands);

// Join: Col2 base + Col3 new-year bands (Col3 overrides where band names overlap)
var joined = col2Base.addBands(col3JoinBands, null, true).updateMask(region.rasterMask);
print('Joined (before remap):', joined);

// ==============================================================================
// 4. PROCESSING — POLYGON-BASED YEAR OVERRIDES
// ==============================================================================

var yearsAll = ee.List.sequence(1985, 2025);

param.remapPolygons.forEach(function(fea) {
  var props = fea.getInfo().features[0].properties;
  var t0    = props.t0;
  var t1    = props.t1;

  var overrideBands = filterYears(yearsAll, t0, t1).getInfo()
    .map(function(y) { return 'classification_' + y; });

  var clasOverride = col3Classification.clip(fea);

  overrideBands.forEach(function(band) {
    var baseband  = joined.select(band);
    var overBand  = clasOverride.select(band);
    baseband = baseband.where(overBand.eq(6), overBand);
    joined   = joined.addBands(baseband, null, true);
  });
});

// ==============================================================================
// 5. EXPORT
// ==============================================================================

var outputImageName = 'FLOODED-' + param.country + '-' + param.regionCode + '-' + param.versionOutput;

joined = joined
  .set('code_region', param.regionCode)
  .set('country',     param.country)
  .set('version',     param.versionOutput)
  .set('process',     'join filter')
  .set('step',        'S04-1');

print('OUTPUT: ' + outputImageName, joined);

Export.image.toAsset({
  image:            joined,
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
  var vis = {
    bands:   ['classification_' + year],
    min:     0,
    max:     mapbiomasPalette.length - 1,
    palette: mapbiomasPalette,
    format:  'png'
  };

  var mosaicYear = mosaics
    .filter(ee.Filter.eq('year', year))
    .mosaic()
    .clip(region.vector);

  Map.addLayer(mosaicYear, {
    bands: ['swir1_median', 'nir_median', 'red_median'],
    gain: [0.08, 0.06, 0.2]
  }, 'Mosaic ' + year, false);

  if (year < 2024) {
    Map.addLayer(col2Base,  vis, 'Col2 base — '   + year, false);
  }
  Map.addLayer(joined, vis, 'Col3 joined — ' + year, false);
});

Map.addLayer(region.vector.style({ color: 'ffffff', fillColor: 'ff000000' }), {}, 'Region');

Map.add(ui.Label('Flooded Col3 - Join Filter - Region ' + param.regionCode, {
  stretch: 'horizontal', textAlign: 'center', fontWeight: 'bold', fontSize: '10px'
}));

// ==============================================================================
// FUNCTIONS
// ==============================================================================

/**
 * Filters a server-side year list to the inclusive range [startYear, endYear].
 */
function filterYears(years, startYear, endYear) {
  return years.filter(ee.Filter.and(
    ee.Filter.gte('item', startYear),
    ee.Filter.lte('item', endYear)
  ));
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
