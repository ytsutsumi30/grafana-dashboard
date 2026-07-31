package com.example.androidvibrationdemo;

import java.util.UUID;

public final class SensorWindowAggregator {
    public interface WindowCommitter {
        void commit(Window window) throws Exception;
    }

    private double sumX;
    private double sumY;
    private double sumZ;
    private double sumMagnitudeSquared;
    private double peakMagnitudeSquared;
    private boolean shock;
    private int latestTapCount;
    private int sampleCount;
    private long windowStartMillis;
    private long latestSampleMillis;

    public synchronized void addSample(
            double x,
            double y,
            double z,
            boolean sampleShock,
            int tapCount,
            long timestampMillis) {
        double magnitudeSquared = x * x + y * y + z * z;

        if (sampleCount == 0) {
            windowStartMillis = timestampMillis;
            latestSampleMillis = timestampMillis;
        } else {
            windowStartMillis = Math.min(windowStartMillis, timestampMillis);
            latestSampleMillis = Math.max(latestSampleMillis, timestampMillis);
        }

        sumX += x;
        sumY += y;
        sumZ += z;
        sumMagnitudeSquared += magnitudeSquared;
        peakMagnitudeSquared = Math.max(peakMagnitudeSquared, magnitudeSquared);
        shock |= sampleShock;
        latestTapCount = tapCount;
        sampleCount += 1;
    }

    public synchronized Window drain(long windowEndMillis) {
        if (sampleCount == 0) {
            return null;
        }
        Window window = createWindow(windowEndMillis);
        resetState();
        return window;
    }

    public synchronized Window drainAfterCommit(long windowEndMillis, WindowCommitter committer) throws Exception {
        if (sampleCount == 0) {
            return null;
        }
        if (committer == null) {
            throw new IllegalArgumentException("committer must not be null");
        }
        Window window = createWindow(windowEndMillis);
        committer.commit(window);
        resetState();
        return window;
    }

    public synchronized Window drain() {
        return drain(latestSampleMillis);
    }

    public synchronized void reset() {
        resetState();
    }

    public synchronized int getSampleCount() {
        return sampleCount;
    }

    private Window createWindow(long windowEndMillis) {
        long effectiveEndMillis = Math.max(windowEndMillis, latestSampleMillis);
        return new Window(
                UUID.randomUUID().toString(),
                sumX / sampleCount,
                sumY / sampleCount,
                sumZ / sampleCount,
                Math.sqrt(sumMagnitudeSquared / sampleCount),
                Math.sqrt(peakMagnitudeSquared),
                shock,
                latestTapCount,
                sampleCount,
                windowStartMillis,
                effectiveEndMillis);
    }

    private void resetState() {
        sumX = 0.0;
        sumY = 0.0;
        sumZ = 0.0;
        sumMagnitudeSquared = 0.0;
        peakMagnitudeSquared = 0.0;
        shock = false;
        latestTapCount = 0;
        sampleCount = 0;
        windowStartMillis = 0L;
        latestSampleMillis = 0L;
    }

    public static final class Window {
        private final String eventId;
        private final double averageX;
        private final double averageY;
        private final double averageZ;
        private final double rmsMagnitude;
        private final double peakMagnitude;
        private final boolean shock;
        private final int tapCount;
        private final int sampleCount;
        private final long windowStartMillis;
        private final long windowEndMillis;

        private Window(
                String eventId,
                double averageX,
                double averageY,
                double averageZ,
                double rmsMagnitude,
                double peakMagnitude,
                boolean shock,
                int tapCount,
                int sampleCount,
                long windowStartMillis,
                long windowEndMillis) {
            this.eventId = eventId;
            this.averageX = averageX;
            this.averageY = averageY;
            this.averageZ = averageZ;
            this.rmsMagnitude = rmsMagnitude;
            this.peakMagnitude = peakMagnitude;
            this.shock = shock;
            this.tapCount = tapCount;
            this.sampleCount = sampleCount;
            this.windowStartMillis = windowStartMillis;
            this.windowEndMillis = windowEndMillis;
        }

        public String getEventId() {
            return eventId;
        }

        public double getAverageX() {
            return averageX;
        }

        public double getAverageY() {
            return averageY;
        }

        public double getAverageZ() {
            return averageZ;
        }

        public double getRmsMagnitude() {
            return rmsMagnitude;
        }

        public double getPeakMagnitude() {
            return peakMagnitude;
        }

        public boolean isShock() {
            return shock;
        }

        public int getTapCount() {
            return tapCount;
        }

        public int getSampleCount() {
            return sampleCount;
        }

        public long getWindowStartMillis() {
            return windowStartMillis;
        }

        public long getWindowEndMillis() {
            return windowEndMillis;
        }
    }
}
