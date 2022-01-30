import itertools
import logging
import struct
import io

import numpy as np

from . import send as _send
from . import recv as _recv
from . import config as _config
from . import framing, common, stream, detect, sampling

log = logging.getLogger(__name__)

autoreconf_fmt = '>BBBB'
autoreconf_size = struct.calcsize(autoreconf_fmt)
autoreconf_silence = 0.1

def send(config, src, dst, gain=1.0, extra_silence=0.0, autoreconf_config=None):
    sender = _send.Sender(dst, config=config, gain=gain)

    if autoreconf_config is not None:
        sender = _send.Sender(dst, config=autoreconf_config, gain=gain)
        sender.write(np.zeros(int(config.Fs * (config.silence_start + extra_silence))))
        training_duration = sender.offset
        log.info('Sending %.3f seconds of training audio', training_duration / config.Fs)
        log.info(('Sending reconfiguration via: Fs={0:.1f} kHz ({1:d}-QAM x {2:d} carriers) Fc={3:.1f} kHz')
            .format(autoreconf_config.Fs / 1e3,
                len(autoreconf_config.symbols),
                autoreconf_config.Nfreq,
                autoreconf_config.Fc / 1e3))
        sender.start()
        sender.modulate(framing.encode(struct.pack(autoreconf_fmt,
            int(config.Fs // 1e3),
            len(config.symbols) - 1,
            int(config.frequencies[0] // 1e3),
            int(config.frequencies[-1] // 1e3)
        )))
        sender.write(np.zeros(int(config.Fs * autoreconf_silence)))
        sender = _send.Sender(dst, config=config, gain=gain)
    else:
        sender.write(np.zeros(int(config.Fs * (config.silence_start + extra_silence))))

    sender.start()
    training_duration = sender.offset
    log.info('Sending %.3f seconds of training audio', training_duration / config.Fs)

    reader = stream.Reader(src, eof=True)
    data = itertools.chain.from_iterable(reader)
    bits = framing.encode(data)
    log.info('Starting modulation')
    sender.modulate(bits=bits)

    data_duration = sender.offset - training_duration
    log.info('Sent %.3f kB @ %.3f seconds',
             reader.total / 1e3, data_duration / config.Fs)

    # post-padding audio with silence
    sender.write(np.zeros(int(config.Fs * config.silence_stop)))
    return True


def recv(config, src, dst, dump_audio=None, pylab=None, autoreconf=None):
    if dump_audio:
        src = stream.Dumper(src, dump_audio)
    reader = stream.Reader(src, data_type=common.loads)
    signal = itertools.chain.from_iterable(reader)

    log.debug('Skipping %.3f seconds', config.skip_start)
    common.take(signal, int(config.skip_start * config.Fs))
    try:
        log.info('Waiting for carrier tone: %.1f kHz', config.Fc / 1e3)

        if autoreconf:
            autoreconf_buffer = io.BytesIO(np.zeros(autoreconf_size))
            autoreconf_dst = io.BufferedRandom(autoreconf_buffer)
            detector = detect.Detector(config=config, pylab=common.Dummy())
            receiver = _recv.Receiver(config=config, pylab=common.Dummy())
            signal, amplitude, freq_error = detector.run(signal)
            log.debug('Frequency correction: %.3f ppm', ((1 / (1.0 + freq_error)) - 1) * 1e6)
            sampler = sampling.Sampler(signal, sampling.defaultInterpolator, freq=1 / (1.0 + freq_error))
            log.debug('Gain correction: %.3f', 1.0 / amplitude)
            receiver.run(sampler, gain=1.0 / amplitude, output=autoreconf_dst)
            autoreconf_dst.seek(0)
            Fs, Nsym, Lf, Hf = struct.unpack(autoreconf_fmt, autoreconf_dst.read(autoreconf_size))
            config = _config.Configuration(Fs=Fs * 1e3, Npoints=Nsym + 1, frequencies=[Lf * 1e3, Hf * 1e3])
            log.info('Reconfigured to: {0:.1f} kb/s ({1:d}-QAM x {2:d} carriers) Fs={3:.1f} kHz'
                .format(config.modem_bps / 1e3, len(config.symbols), config.Nfreq, config.Fs / 1e3))
            log.info('Waiting for carrier tone: %.1f kHz', config.Fc / 1e3)

        pylab = pylab or common.Dummy()
        detector = detect.Detector(config=config, pylab=pylab)
        receiver = _recv.Receiver(config=config, pylab=pylab)
        signal, amplitude, freq_error = detector.run(signal)
        log.debug('Frequency correction: %.3f ppm', ((1 / (1.0 + freq_error)) - 1) * 1e6)
        sampler = sampling.Sampler(signal, sampling.defaultInterpolator, freq=1 / (1.0 + freq_error))
        log.debug('Gain correction: %.3f', 1.0 / amplitude)
        receiver.run(sampler, gain=1.0 / amplitude, output=dst)
        return True
    except BaseException:  # pylint: disable=broad-except
        log.exception('Decoding failed')
        return False
    finally:
        dst.flush()
        receiver.report()
