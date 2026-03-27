/**
 * ==============================================================================
 * MAPBIOMAS COLOMBIA - COLLECTION 3 - CROSS-CUTTING: FLOODED
 * STEP 01: REFERENCE AREAS — MASK GENERATION
 * ==============================================================================
 * @version       1.0
 * @update        March 2026
 * @attribution   MapBiomas Colombia (Fundacion Gaia Amazonas)
 * @description   Accumulates flooded reference layers to generate a binary
 *                classification mask for the region of interest. Supports
 *                selective layer inclusion, spatial filtering by connected
 *                pixel count, proportional or fixed buffer expansion, and
 *                polygon-based inclusion/exclusion editing.
 * @inputs        - Reference rasters (AUXILIARY_DATA/RASTERS/WETLANDS/)
 *                - MapBiomas Colombia Collection 2 integration image
 * @outputs       - Earth Engine Asset: binary flooded mask
 *                  saved to 'FLOODED/STEP1_REGIONS/classification_mask/'
 *                - Optional CSV export to Google Drive
 * @geom_struct   INCLUSION / EXCLUSION GEOMETRIES:
 *                'inclusion': FeatureCollection — areas forced into the mask.
 *                             Features must have a 'value' property = 1.
 *                'exclusion': FeatureCollection — areas removed from the mask.
 *                             Features must have a 'value' property = 1.
 * ==============================================================================
 */

// ==============================================================================
// 1. USER PARAMETERS
// ==============================================================================

// Geometry imports from Code Editor (replace [] with actual features as needed)
var inclusion = /* color: #3614d6 */ ee.FeatureCollection([]);
var exclusion = /* color: #ff0000 */ ee.FeatureCollection([]);

var param = {
  regionCode:    30430,
  country:       'COLOMBIA',
  previewYears:  [1994, 2007],
  referenceLayers: [
    // Select reference layers to accumulate.
    // If empty, all layers are used.
    // 'cifor',
    // 'nasa_100m',
    // 'tootchi',
    // 'gfplain250',
    // 'col_ref_inundable06_raisg',
    // 'acumulado_flooded_col2',
    'stable_flooded_col2',
    'HumedalesCol',
  ],
  spatialFilter: {
    enabled:          false,
    minGroupedPixels: 20
  },
  proportionalBuffer: {
    enabled:     true,    // If false, fixed BUFFER is applied to all patches
    threshold:   800,     // Connected pixel count threshold (large vs small patches)
    lowerBuffer: 100      // Buffer distance (m) applied to small patches
  },
  BUFFER:        30,      // Fixed buffer distance (m) — used when proportionalBuffer.enabled = false
  versionOutput: '1',
  exportDrive:   false,
  includeExclude: {
    inclusion: inclusion,
    exclusion: exclusion
  }
};

// ==============================================================================
// 2. IMPORTS & ASSETS
// ==============================================================================

var palettes = require('users/mapbiomas_caribe/public_repo_mbcolombia:mbcolombia-col3/modules/Palettes.js');
var mapbiomasPalette = palettes.get('ColombiaCol3');

var basePath  = 'projects/ee-mapbiomasdeveloper/assets/';
var dstRaster = basePath + 'PUBLIC_ASSETS/AUXILIARY_DATA/RASTERS/WETLANDS/';
var dstVector = basePath + 'PUBLIC_ASSETS/AUXILIARY_DATA/VECTORS/WETLANDS/';

var assets = {
  regions:          dstVector + 'ClasificacionRegionesInundables2024C2',
  regionesMosaicos: basePath  + 'PUBLIC_ASSETS/AUXILIARY_DATA/VECTORS/regiones-mosaicos-2024-buffer-250',
  col2Integration:  'projects/mapbiomas-public/assets/colombia/collection2/mapbiomas_colombia_collection2_integration_v1',
  cifor:            dstRaster + 'TROP-SUBTROP_PeatV21_2016_CIFOR',
  nasa_100m:        dstRaster + 'LBA_Amazon_wetland_dual-season_veg_flood_AA100m',
  globalTootchi:    dstRaster + 'CW_TCI',
  gfplain250:       'projects/sat-io/open-datasets/GFPLAIN250',
  colRefRaisg:      dstRaster + 'col_ref_inunFul_Sirgas20001',
  humedalesCol:     'users/mapbiomasdesarrollo/Colombia_C2/Datos_Auxiliares/Raster/RasterHumedales2024',
  outputAsset:      basePath + 'LULC/COLLECTION3/CROSS_CUTTING/FLOODED/STEP1_REGIONS/classification_mask/'
};

// ==============================================================================
// 3. INITIALIZATION & DATA LOADING
// ==============================================================================

var regionsFC        = ee.FeatureCollection(assets.regions);
var regionData       = regionsFC.filter(ee.Filter.eq('id_regionC', param.regionCode));
var regionsByCountry = regionsFC.filter(ee.Filter.eq('pais', 'Colombia'));

var regionMask = regionData
  .map(function(item) { return item.set('version', 1); })
  .reduceToImage(['version'], ee.Reducer.first());

var col2Integration  = ee.Image(assets.col2Integration).clip(regionData);
var mosaics          = getMosaic(regionsByCountry);
var mosaicRegionCode = Number(param.regionCode.toString().slice(0, 3));

var cifor = ee.Image(assets.cifor)
  .updateMask(regionMask).eq(1).selfMask();

var nasa100m = ee.Image(assets.nasa_100m)
  .updateMask(regionMask)
  .updateMask(ee.Image(assets.nasa_100m).gt(1))
  .updateMask(ee.Image(assets.nasa_100m).neq(200));

var globalTootchi = ee.Image(assets.globalTootchi)
  .updateMask(regionMask)
  .updateMask(ee.Image(assets.globalTootchi).gt(1));

var gfplain250 = ee.ImageCollection(assets.gfplain250)
  .mosaic().updateMask(regionMask);

var colRefRaisg = ee.Image(assets.colRefRaisg)
  .updateMask(regionMask);

var humedalesCol = ee.Image(assets.humedalesCol)
  .updateMask(regionMask)
  .rename('HumedalesCol');

// Preview mosaics
param.previewYears.forEach(function(year) {
  var mosaicYear = mosaics
    .filter(ee.Filter.eq('region_code', mosaicRegionCode))
    .select(['swir1_median', 'nir_median', 'red_median'])
    .filter(ee.Filter.eq('year', year))
    .mosaic()
    .updateMask(regionMask);
  Map.addLayer(mosaicYear, { gain: [0.08, 0.06, 0.08], gamma: 0.65 }, 'Mosaic ' + year, false);
});

// ==============================================================================
// 4. REFERENCE LAYER PROCESSING
// ==============================================================================

// Accumulated and stable flooded pixels from Col2 integration (class 6)
var flooded = col2Integration.eq(6);
var ref_accumulatedFlooded = flooded.reduce('sum').rename('acumulado_flooded_col2');
var ref_stableFlooded      = ref_accumulatedFlooded.eq(39).selfMask().rename('stable_flooded_col2');

// Individual reference layers
var ref_cifor            = cifor.eq(1).rename('cifor');
var ref_nasa_100m        = nasa100m.gte(23).rename('nasa_100m');
var ref_global_tootchi   = globalTootchi.gte(1).rename('tootchi');
var ref_gfplain250       = gfplain250.gte(0).rename('gfplain250');
var ref_colombia06_raisg = colRefRaisg.eq(1).rename('col_ref_inundable06_raisg');

var vizAccumulate = ['#fff7fb', '#ece7f2', '#d0d1e6', '#a6bddb',
                     '#74a9cf', '#3690c0', '#0570b0', '#045a8d', '#023858'];

Map.addLayer(ref_accumulatedFlooded, { min: 0, max: 39, palette: vizAccumulate }, 'acumulado_flooded', false);
Map.addLayer(ref_stableFlooded,      { palette: ['#023858'] },                    'stableFlooded',     false);

// Accumulate all reference layers
var ACUMULADO_TOTAL = ee.Image(0)
  .addBands(ref_stableFlooded)
  .addBands(ref_accumulatedFlooded)
  .addBands(ref_cifor)
  .addBands(ref_nasa_100m)
  .addBands(ref_global_tootchi)
  .addBands(ref_gfplain250)
  .addBands(ref_colombia06_raisg)
  .addBands(humedalesCol)
  .updateMask(regionMask);

Map.addLayer(ACUMULADO_TOTAL.reduce('sum').selfMask(), { palette: ['#7cc0c2'] }, 'Mask — all references', true);

// Build binary export mask from selected layers (or all if none specified)
var imageExport = ACUMULADO_TOTAL.reduce('sum').selfMask().pow(0);

if (param.referenceLayers.length > 0) {
  var mascaraFiltrada = ACUMULADO_TOTAL
    .select(param.referenceLayers)
    .reduce('sum')
    .selfMask()
    .pow(0);
  imageExport = mascaraFiltrada;
  Map.addLayer(mascaraFiltrada, { palette: ['#b6e4e5'] }, 'Mask — filtered references', true);
}

imageExport = imageExport.toInt8();
imageExport = imageExport.reproject('EPSG:4326', null, 30);

var conect = imageExport.connectedPixelCount(1000).rename('connected');
Map.addLayer(imageExport, {}, 'Mask — before buffer', false);

// ==============================================================================
// 5. MASK FILTERING
// ==============================================================================

// Apply inclusion / exclusion polygons
imageExport = applyIncludeExclude(
  imageExport,
  param.includeExclude.inclusion,
  param.includeExclude.exclusion
);

// Spatial filter: remove patches smaller than minGroupedPixels
if (param.spatialFilter.enabled) {
  Map.addLayer(
    conect,
    { bands: ['connected'], min: 1, max: 100, palette: ['b90000', 'ff0000', 'ffbf10', 'f2ff1b', '23ff47', '10c9ff'] },
    'Connected pixel count', false
  );
  imageExport = imageExport.mask(
    conect.select('connected').gte(param.spatialFilter.minGroupedPixels)
  );
  print(conect.projection().nominalScale());
}

// Fixed buffer (applied when proportionalBuffer is disabled)
if (!param.proportionalBuffer.enabled) {
  var bufferMask = ee.Image(1)
    .cumulativeCost({ source: imageExport, maxDistance: param.BUFFER })
    .lt(param.BUFFER);
  bufferMask = ee.Image(0).where(bufferMask.eq(1), 1).selfMask().updateMask(regionMask);
  imageExport = bufferMask;
  Map.addLayer(bufferMask, {}, 'Mask — fixed buffer', false);
}

// Proportional buffer: large patches get BUFFER, small patches get lowerBuffer
if (param.proportionalBuffer.enabled) {
  var largePatches = imageExport
    .mask(conect.select('connected').gte(param.proportionalBuffer.threshold))
    .selfMask();
  var smallPatches = imageExport
    .mask(conect.select('connected').lt(param.proportionalBuffer.threshold))
    .selfMask();

  var bufferLarge = ee.Image(1)
    .cumulativeCost({ source: largePatches, maxDistance: param.BUFFER })
    .lt(param.BUFFER);
  bufferLarge = ee.Image(0).where(bufferLarge.eq(1), 1).selfMask();

  var bufferSmall = ee.Image(1)
    .cumulativeCost({ source: smallPatches, maxDistance: param.proportionalBuffer.lowerBuffer })
    .lt(param.proportionalBuffer.lowerBuffer);
  bufferSmall = ee.Image(0).where(bufferSmall.eq(1), 1).selfMask();

  var proportionalBufferMask = ee.Image(0)
    .where(bufferLarge, 1)
    .where(bufferSmall, 1)
    .updateMask(regionMask)
    .selfMask();

  imageExport = proportionalBufferMask;
  Map.addLayer(proportionalBufferMask, {}, 'Mask — proportional buffer', true);
}

imageExport = imageExport.toInt8();
print('Output Image:', imageExport);
Map.addLayer(imageExport, {}, 'Output Mask', true);

// ==============================================================================
// 6. EXPORT
// ==============================================================================

var outputName = 'FLOODED-ROI-' + param.country + '-' + param.regionCode + '-' + param.versionOutput;

if (param.exportDrive) {
  Export.image.toDrive({
    image:       imageExport,
    description: outputName,
    folder:      'EXPORT-MAPBIOMAS',
    scale:       30,
    maxPixels:   1e13,
    region:      regionData.geometry().bounds(),
    shardSize:   1024
  });
}

Export.image.toAsset({
  image:            imageExport,
  description:      outputName,
  assetId:          assets.outputAsset + outputName,
  pyramidingPolicy: { '.default': 'mode' },
  scale:            30,
  maxPixels:        1e13,
  region:           regionData.geometry().bounds()
});

// ==============================================================================
// 7. VISUALIZATION
// ==============================================================================

Map.setOptions('SATELLITE');

Map.addLayer(ref_cifor,            {}, 'cifor',                      false);
Map.addLayer(humedalesCol,         {}, 'HumedalesCol',               false);
Map.addLayer(ref_colombia06_raisg, {}, 'col_ref_inundable06_raisg',  false);
Map.addLayer(ref_gfplain250,       {}, 'gfplain250',                 false);
Map.addLayer(ref_global_tootchi,   {}, 'tootchi',                    false);
Map.addLayer(ref_nasa_100m,        {}, 'nasa_100m',                  false);

// ==============================================================================
// HELPER FUNCTIONS
// ==============================================================================

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
