using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

// Read-only input observer: no hooks, keyboard state, cursor position, or injection.
internal static class MouseButtons
{
    private const int LeftButton = 0x01;
    private static readonly ManualResetEvent Stop = new ManualResetEvent(false);

    [DllImport("user32.dll")]
    private static extern short GetAsyncKeyState(int virtualKey);

    private static bool WriteState(string type, bool down, long sequence)
    {
        try
        {
            Console.Out.WriteLine("{\"type\":\"" + type + "\",\"button\":\"left\",\"down\":" + (down ? "true" : "false") + ",\"seq\":" + sequence + "}");
            Console.Out.Flush();
            return true;
        }
        catch (IOException) { return false; }
        catch (ObjectDisposedException) { return false; }
    }

    public static int Main(string[] args)
    {
        try
        {
            int parentId;
            if (args.Length != 2 || args[0] != "--parent-pid" || !Int32.TryParse(args[1], out parentId) || parentId <= 0) return 2;
            using (Process parent = Process.GetProcessById(parentId))
            {
                if (parent.HasExited) return 0;
                Console.OutputEncoding = new UTF8Encoding(false);
                // EOF means the Electron parent closed its pipe. A background reader
                // cannot keep this observer alive after its main loop has stopped.
                Thread input = new Thread(delegate()
                {
                    try { while (Console.In.Read() >= 0) { } }
                    catch (IOException) { }
                    catch (ObjectDisposedException) { }
                    finally { Stop.Set(); }
                });
                input.IsBackground = true;
                input.Start();

                Stopwatch clock = Stopwatch.StartNew();
                bool previous = false, first = true;
                long lastHeartbeat = -1000, sequence = 0;
                while (!Stop.WaitOne(0))
                {
                    if (parent.HasExited) break;
                    bool down = (GetAsyncKeyState(LeftButton) & 0x8000) != 0;
                    long now = clock.ElapsedMilliseconds;
                    if (first || down != previous)
                    {
                        if (!WriteState("button", down, sequence++)) break;
                        first = false;
                        previous = down;
                        lastHeartbeat = now;
                    }
                    // Fresh held samples let a newly captured DOM gesture
                    // confirm its own press even when the edge reached main first.
                    else if (now - lastHeartbeat >= (down ? 32 : 1000))
                    {
                        if (!WriteState("heartbeat", down, sequence++)) break;
                        lastHeartbeat = now;
                    }
                    if (Stop.WaitOne(32)) break;
                }
            }
            return 0;
        }
        catch { return 2; } // No desktop data or exception details are written to stderr.
    }
}
