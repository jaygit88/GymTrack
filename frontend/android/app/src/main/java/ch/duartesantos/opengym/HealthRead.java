package ch.duartesantos.opengym;

import androidx.health.connect.client.records.ExerciseSessionRecord;
import androidx.health.connect.client.records.HeartRateRecord;
import androidx.health.connect.client.records.WeightRecord;
import androidx.health.connect.client.records.metadata.Metadata;
import java.util.ArrayList;
import java.util.List;

/**
 * What HealthConnectPlugin hands to JS when it reads (v1.4.3): plain values, no Android classes,
 * so it is tested on the JVM (HealthReadTest). Heart rate as [ms, bpm] pairs inside the window
 * asked for; weigh-ins as { t, kg, id, origin, clientId }. Which of them openGym takes, and how,
 * is decided in JS (lib/health-read.js), which also skips openGym's own records.
 */
final class HealthRead {
    private HealthRead() {}

    // Beyond this no reading is plausible; lib/heart-rate.js applies the same bounds again.
    static final long BPM_MIN = 25;
    static final long BPM_MAX = 250;
    // A workout of a few hours at one sample a second is well under this.
    static final int MAX_SAMPLES = 50000;

    /** The samples of these records that lie in [from, to], oldest first. */
    static List<long[]> samples(List<HeartRateRecord> records, long from, long to) {
        List<long[]> out = new ArrayList<>();
        for (HeartRateRecord r : records) {
            for (HeartRateRecord.Sample s : r.getSamples()) {
                long t = s.getTime().toEpochMilli();
                long bpm = s.getBeatsPerMinute();
                if (t < from || t > to || bpm < BPM_MIN || bpm > BPM_MAX) continue;
                out.add(new long[] { t, bpm });
                if (out.size() >= MAX_SAMPLES) break;
            }
            if (out.size() >= MAX_SAMPLES) break;
        }
        out.sort((a, b) -> Long.compare(a[0], b[0]));
        return out;
    }

    /** One weigh-in as JS gets it. */
    static final class Weight {
        final long t;
        final double kg;
        final String id, origin, clientId;

        Weight(long t, double kg, String id, String origin, String clientId) {
            this.t = t; this.kg = kg; this.id = id; this.origin = origin; this.clientId = clientId;
        }
    }

    static List<Weight> weights(List<WeightRecord> records) {
        List<Weight> out = new ArrayList<>();
        for (WeightRecord r : records) {
            Metadata m = r.getMetadata();
            double kg = r.getWeight().getKilograms();
            if (!(kg > 0)) continue;
            out.add(new Weight(r.getTime().toEpochMilli(), kg, m.getId(),
                    m.getDataOrigin().getPackageName(), m.getClientRecordId()));
        }
        return out;
    }

    /** The JS names of the read permissions, as the manifest declares them. */
    static String readPermission(String name) {
        switch (name) {
            case "heartRate": return "android.permission.health.READ_HEART_RATE";
            case "weight": return "android.permission.health.READ_WEIGHT";
            // Not a data type: data older than 30 days before the first grant (#801).
            case "history": return "android.permission.health.READ_HEALTH_DATA_HISTORY";
            // GymTrack: runs other apps saved (a Galaxy Watch through Samsung Health), and their distance.
            case "exercise": return "android.permission.health.READ_EXERCISE";
            case "distance": return "android.permission.health.READ_DISTANCE";
            case "speed": return "android.permission.health.READ_SPEED";
            case "elevation": return "android.permission.health.READ_ELEVATION_GAINED";
            case "steps": return "android.permission.health.READ_STEPS";
            case "calories": return "android.permission.health.READ_ACTIVE_CALORIES_BURNED";
            case "vo2max": return "android.permission.health.READ_VO2_MAX";
            case "restingHeartRate": return "android.permission.health.READ_RESTING_HEART_RATE";
            default: return null;
        }
    }

    static String writePermission(String name) {
        switch (name) {
            case "exercise": return "android.permission.health.WRITE_EXERCISE";
            case "weight": return "android.permission.health.WRITE_WEIGHT";
            default: return null;
        }
    }

    // ---- GymTrack: exercise sessions other apps saved, for runs (lib/runs.js decides which) ----

    /** One exercise session as JS gets it; `meters` is filled in from the distance records. */
    static final class Session {
        final String id, origin, clientId, type, title;
        final long start, end;
        double meters;
        // GymTrack: what else the run's app saved inside it (filled in for runs only).
        List<long[]> hr = new ArrayList<>();        // [ms, bpm], at most one per SAMPLE_GAP_MS
        List<double[]> speed = new ArrayList<>();   // [ms, m/s], the same
        List<double[]> laps = new ArrayList<>();    // [start ms, end ms, metres or -1]
        long steps = -1;
        double elevation = -1, kcal = -1;

        Session(String id, String origin, String clientId, long start, long end, String type, String title) {
            this.id = id; this.origin = origin; this.clientId = clientId;
            this.start = start; this.end = end; this.type = type; this.title = title;
        }
    }

    /** One distance record, reduced to what the sum needs. */
    static final class Dist {
        final long start, end;
        final String origin;
        final double meters;

        Dist(long start, long end, String origin, double meters) {
            this.start = start; this.end = end; this.origin = origin; this.meters = meters;
        }
    }

    /** The JS name of a session type; the ones lib/runs.js may want, everything else "other". */
    static String typeName(int type) {
        if (type == ExerciseSessionRecord.EXERCISE_TYPE_RUNNING) return "running";
        if (type == ExerciseSessionRecord.EXERCISE_TYPE_RUNNING_TREADMILL) return "running_treadmill";
        if (type == ExerciseSessionRecord.EXERCISE_TYPE_WALKING) return "walking";
        if (type == ExerciseSessionRecord.EXERCISE_TYPE_HIKING) return "hiking";
        if (type == ExerciseSessionRecord.EXERCISE_TYPE_BIKING) return "biking";
        if (type == ExerciseSessionRecord.EXERCISE_TYPE_STRENGTH_TRAINING) return "strength_training";
        return "other";
    }

    static List<Session> sessions(List<ExerciseSessionRecord> records) {
        List<Session> out = new ArrayList<>();
        for (ExerciseSessionRecord r : records) {
            Metadata m = r.getMetadata();
            CharSequence title = r.getTitle();
            out.add(new Session(m.getId(), m.getDataOrigin().getPackageName(), m.getClientRecordId(),
                    r.getStartTime().toEpochMilli(), r.getEndTime().toEpochMilli(),
                    typeName(r.getExerciseType()), title == null ? null : title.toString()));
        }
        return out;
    }

    /**
     * The distance of one session: the distance records the same app saved inside it, summed.
     * Only the session's own app, so a phone's step distance for the same minutes is not added
     * to the watch's. A minute of slack at either end for records that straddle the edges.
     */
    static double metersFor(Session s, List<Dist> distances) {
        double sum = 0;
        for (Dist d : distances) {
            if (d.origin == null || !d.origin.equals(s.origin)) continue;
            if (d.start < s.start - 60_000 || d.end > s.end + 60_000) continue;
            if (d.meters > 0) sum += d.meters;
        }
        return sum;
    }

    // A sample every few seconds is plenty for averages, zones and splits, and keeps a two-hour
    // run's heart rate to a couple of thousand points on the way to JS.
    static final long SAMPLE_GAP_MS = 5000;

    /** Heart-rate samples inside [from, to], thinned to one per SAMPLE_GAP_MS, oldest first. */
    static List<long[]> thinHr(List<long[]> samples) {
        List<long[]> out = new ArrayList<>();
        long last = Long.MIN_VALUE;
        for (long[] s : samples) {
            if (s[0] - last < SAMPLE_GAP_MS) continue;
            out.add(s);
            last = s[0];
        }
        return out;
    }

    /** Speed samples [ms, m/s] inside [from, to], thinned like heart rate, oldest first. */
    static List<double[]> thinSpeed(List<double[]> samples, long from, long to) {
        List<double[]> sorted = new ArrayList<>();
        for (double[] s : samples) if (s[0] >= from && s[0] <= to && s[1] >= 0 && s[1] < 15) sorted.add(s);
        sorted.sort((a, b) -> Double.compare(a[0], b[0]));
        List<double[]> out = new ArrayList<>();
        double last = Double.NEGATIVE_INFINITY;
        for (double[] s : sorted) {
            if (s[0] - last < SAMPLE_GAP_MS) continue;
            out.add(s);
            last = s[0];
        }
        return out;
    }
}
