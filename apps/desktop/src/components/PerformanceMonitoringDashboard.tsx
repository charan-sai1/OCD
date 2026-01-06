import React, { useState, useEffect } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Grid,
  LinearProgress,
  Chip,
  IconButton,
  Collapse,
  Button
} from '@mui/material';
import {
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
  Refresh as RefreshIcon
} from '@mui/icons-material';
import { systemResourceManager } from '../utils/systemResourceManager';
import { performanceMonitor } from '../utils/performanceMonitor';
import { imageUrlCache } from '../utils/imageUrlCache';
import { scrollPreloader } from '../utils/scrollPreloader';
import { imageElementPool } from '../utils/imageElementPool';

interface PerformanceMetrics {
  memoryUsage: number;
  memoryPressure: string;
  cpuUsage: number;
  scrollFPS: number;
  cacheHitRate: number;
  preloadEfficiency: number;
}

const PerformanceMonitoringDashboard: React.FC = () => {
  const [expanded, setExpanded] = useState(false);
  const [metrics, setMetrics] = useState<PerformanceMetrics>({
    memoryUsage: 0,
    memoryPressure: 'normal',
    cpuUsage: 0,
    scrollFPS: 0,
    cacheHitRate: 0,
    preloadEfficiency: 0
  });

  const [systemInfo, setSystemInfo] = useState<any>(null);

  useEffect(() => {
    const updateMetrics = () => {
      const systemMetrics = systemResourceManager.getCurrentMetrics();
      const resourceBudget = systemResourceManager.getResourceBudget();
      const perfStats = performanceMonitor.getStats('scroll_frame');
      const cacheStats = imageUrlCache.getStats();
      const preloadStats = scrollPreloader.getStats();
      const poolStats = imageElementPool.getStats();

      setMetrics({
        memoryUsage: resourceBudget.memoryMB,
        memoryPressure: systemMetrics.memoryPressure,
        cpuUsage: systemMetrics.cpuUsage,
        scrollFPS: perfStats ? 1000 / perfStats.average : 60,
        cacheHitRate: cacheStats.cachedUrls > 0 ? 0.85 : 0, // Placeholder calculation
        preloadEfficiency: poolStats.poolEfficiency || 0
      });

      setSystemInfo({
        ...systemMetrics,
        resourceBudget,
        cacheStats,
        preloadStats,
        poolStats,
        perfStats
      });
    };

    updateMetrics();
    const interval = setInterval(updateMetrics, 2000); // Update every 2 seconds

    return () => clearInterval(interval);
  }, []);

  const getMemoryPressureColor = (pressure: string) => {
    switch (pressure) {
      case 'critical': return 'error';
      case 'warning': return 'warning';
      default: return 'success';
    }
  };

  const getPerformanceScore = () => {
    const { memoryPressure, scrollFPS, cacheHitRate } = metrics;
    let score = 100;

    if (memoryPressure === 'critical') score -= 40;
    else if (memoryPressure === 'warning') score -= 20;

    if (scrollFPS < 45) score -= 30;
    else if (scrollFPS < 55) score -= 15;

    if (cacheHitRate < 0.7) score -= 10;

    return Math.max(0, score);
  };

  return (
    <Card sx={{ mb: 2 }}>
      <CardContent>
        <Box display="flex" alignItems="center" justifyContent="space-between">
          <Typography variant="h6" component="div">
            Performance Monitor
          </Typography>
          <Box>
            <Chip
              label={`Score: ${getPerformanceScore()}`}
              color={getPerformanceScore() > 70 ? 'success' : getPerformanceScore() > 40 ? 'warning' : 'error'}
              size="small"
              sx={{ mr: 1 }}
            />
            <IconButton onClick={() => setExpanded(!expanded)} size="small">
              {expanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
            </IconButton>
            <IconButton onClick={() => window.location.reload()} size="small">
              <RefreshIcon />
            </IconButton>
          </Box>
        </Box>

        <Grid container spacing={2} sx={{ mt: 1 }}>
          <Grid item xs={6} sm={3}>
            <Typography variant="body2" color="text.secondary">
              Memory Pressure
            </Typography>
            <Chip
              label={metrics.memoryPressure}
              color={getMemoryPressureColor(metrics.memoryPressure)}
              size="small"
            />
          </Grid>
          <Grid item xs={6} sm={3}>
            <Typography variant="body2" color="text.secondary">
              Scroll FPS
            </Typography>
            <Typography variant="h6">
              {metrics.scrollFPS.toFixed(1)}
            </Typography>
          </Grid>
          <Grid item xs={6} sm={3}>
            <Typography variant="body2" color="text.secondary">
              Memory Usage
            </Typography>
            <Typography variant="h6">
              {metrics.memoryUsage.toFixed(0)}MB
            </Typography>
          </Grid>
          <Grid item xs={6} sm={3}>
            <Typography variant="body2" color="text.secondary">
              Cache Hit Rate
            </Typography>
            <Typography variant="h6">
              {(metrics.cacheHitRate * 100).toFixed(0)}%
            </Typography>
          </Grid>
        </Grid>

        <Collapse in={expanded}>
          <Box sx={{ mt: 2 }}>
            <Typography variant="subtitle1" sx={{ mb: 2 }}>
              Detailed Metrics
            </Typography>

            {systemInfo && (
              <Grid container spacing={2}>
                <Grid item xs={12} md={6}>
                  <Card variant="outlined">
                    <CardContent>
                      <Typography variant="subtitle2" gutterBottom>
                        System Resources
                      </Typography>
                      <Box sx={{ mb: 1 }}>
                        <Typography variant="body2">
                          CPU Usage: {systemInfo.cpuUsage.toFixed(1)}%
                        </Typography>
                        <LinearProgress
                          variant="determinate"
                          value={Math.min(100, systemInfo.cpuUsage)}
                          color={systemInfo.cpuUsage > 80 ? 'error' : systemInfo.cpuUsage > 60 ? 'warning' : 'success'}
                        />
                      </Box>
                      <Typography variant="body2">
                        Battery: {systemInfo.batteryLevel > 0 ? `${systemInfo.batteryLevel}%` : 'Unknown'}
                      </Typography>
                      <Typography variant="body2">
                        Network: {systemInfo.networkQuality}
                      </Typography>
                    </CardContent>
                  </Card>
                </Grid>

                <Grid item xs={12} md={6}>
                  <Card variant="outlined">
                    <CardContent>
                      <Typography variant="subtitle2" gutterBottom>
                        Cache & Pool Stats
                      </Typography>
                      <Typography variant="body2">
                        URL Cache: {systemInfo.cacheStats.cachedUrls} URLs
                      </Typography>
                      <Typography variant="body2">
                        Element Pool: {systemInfo.poolStats.inUse} in use, {systemInfo.poolStats.available} available
                      </Typography>
                      <Typography variant="body2">
                        Active Preloads: {systemInfo.preloadStats.activePreloads}
                      </Typography>
                      <Typography variant="body2">
                        Pool Efficiency: {(systemInfo.poolStats.poolEfficiency * 100).toFixed(1)}%
                      </Typography>
                    </CardContent>
                  </Card>
                </Grid>
              </Grid>
            )}

            <Box sx={{ mt: 2, display: 'flex', gap: 1 }}>
              <Button
                size="small"
                variant="outlined"
                onClick={() => imageElementPool.emergencyCleanup(5)}
              >
                Emergency Cleanup
              </Button>
              <Button
                size="small"
                variant="outlined"
                onClick={() => {
                  imageUrlCache.clear();
                  scrollPreloader.cancelAllPreloads();
                }}
              >
                Clear Caches
              </Button>
              <Button
                size="small"
                variant="outlined"
                onClick={() => performanceMonitor.logAllStats()}
              >
                Log Performance Stats
              </Button>
            </Box>
          </Box>
        </Collapse>
      </CardContent>
    </Card>
  );
};

export default PerformanceMonitoringDashboard;