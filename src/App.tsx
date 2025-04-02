import { useState, useEffect } from 'react';
import { Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import NewServe from './pages/NewServe';
import Clients from './pages/Clients';
import History from './pages/History';
import Settings from './pages/Settings';
import Index from './pages/Index';
import MigrationPage from './pages/Migration';
import DataExport from './pages/DataExport';
import { ServeAttemptData } from './components/ServeAttempt';
import { ClientData } from './components/ClientForm';
import { appwrite } from './lib/appwrite';
import {
  checkAppwriteConnection,
  loadDataFromAppwrite,
  clearLocalStorage,
  getActiveBackend,
} from "./utils/dataSwitch";
import { BACKEND_PROVIDER, APPWRITE_CONFIG } from "./config/backendConfig";
import { toast } from "@/hooks/use-toast";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { initializeDebugTools } from '@/utils/debugUtils';
import { normalizeServeDataArray } from "@/utils/dataNormalization";
import { sendEmail, createDeleteNotificationEmail } from "@/utils/email";

// Initialize debug tools for development
if (process.env.NODE_ENV !== 'production') {
  initializeDebugTools();
}

// Create TypeScript interface for window to avoid TS errors
declare global {
  interface Window {
    debugAppwrite: () => void;
    testDeleteClient: (clientId: string) => void;
  }
}

// Debug helper for older browser console support
window.debugAppwrite = function() {
  console.log('Appwrite Config:', {
    endpoint: import.meta.env.VITE_APPWRITE_ENDPOINT || "https://cloud.appwrite.io/v1",
    projectId: import.meta.env.VITE_APPWRITE_PROJECT_ID || "67ead974001245b7c6aa",
    databaseId: import.meta.env.VITE_APPWRITE_DATABASE_ID || "67eae6fe0020c6721531", // Correct databaseId
    clientsCollectionId: import.meta.env.VITE_APPWRITE_CLIENTS_COLLECTION_ID || "67eae70e000c042112c8",
    serveAttemptsCollectionId: import.meta.env.VITE_APPWRITE_SERVE_ATTEMPTS_COLLECTION_ID || "67eae7ef8034c7ad35f6", // Correct collectionId
  });
  
  // Test API
  appwrite.getClients()
    .then(clients => console.log('Clients:', clients))
    .catch(err => console.error('Error fetching clients:', err));
    
  // Print instructions to test deletion  
  console.log('To test client deletion, run:');
  console.log('window.testDeleteClient("CLIENT_ID_HERE")');
};

// Test delete client function
window.testDeleteClient = function(clientId) {
  console.log(`Testing deletion of client ${clientId}`);
  appwrite.deleteClient(clientId)
    .then(result => console.log('Delete result:', result))
    .catch(err => console.error('Error deleting client:', err));
};

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 5000,
    },
    mutations: {
      onError: (error) => {
        console.error("Mutation error:", error);
      }
    }
  }
});

const AnimatedRoutes = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [clients, setClients] = useState<ClientData[]>(() => {
    const savedClients = localStorage.getItem("serve-tracker-clients");
    return savedClients ? JSON.parse(savedClients) : [];
  });
  const [serves, setServes] = useState<ServeAttemptData[]>(() => {
    const savedServes = localStorage.getItem("serve-tracker-serves");
    console.log("Initial load from localStorage serve-tracker-serves:", 
      savedServes ? JSON.parse(savedServes).length : 0, "entries");
    return savedServes ? JSON.parse(savedServes) : [];
  });
  const [isInitialSync, setIsInitialSync] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [showAppwriteAlert, setShowAppwriteAlert] = useState(false);

  useEffect(() => {
    const checkBackend = async () => {
      const isAppwriteConnected = await checkAppwriteConnection();
      if (isAppwriteConnected) {
        console.log("Using Appwrite as primary backend");
        const cleanup = appwrite.setupRealtimeSubscription((response) => {
          console.log("Received real-time update from Appwrite:", response);
          loadAppwriteData();
        });
        return cleanup;
      } else {
        console.log("Failed to connect to Appwrite, using local storage fallback");
        setShowAppwriteAlert(true);
        return () => {};
      }
    };
    checkBackend();
  }, []);

  const loadAppwriteData = async () => {
    try {
      setIsSyncing(true);
      const { clients: appwriteClients, serves: appwriteServes } = await loadDataFromAppwrite();
      if (appwriteClients.length > 0) {
        setClients(appwriteClients);
        localStorage.setItem("serve-tracker-clients", JSON.stringify(appwriteClients));
      }
      if (appwriteServes.length > 0) {
        setServes(appwriteServes);
        localStorage.setItem("serve-tracker-serves", JSON.stringify(appwriteServes));
      }
      setDataLoaded(true);
    } catch (error) {
      console.error("Error loading data from Appwrite:", error);
    } finally {
      setIsSyncing(false);
    }
  };

  useEffect(() => {
    const performInitialSync = async () => {
      if (isInitialSync) {
        setIsSyncing(true);
        try {
          console.log("Performing initial sync from Appwrite");
          await loadAppwriteData();
        } catch (error) {
          console.error("Error during initial sync:", error);
        } finally {
          setIsSyncing(false);
          setIsInitialSync(false);
        }
      }
    };
    performInitialSync();
  }, [isInitialSync]);

  useEffect(() => {
    const syncInterval = setInterval(async () => {
      try {
        console.log("Running periodic sync with Appwrite...");
        await loadAppwriteData();
      } catch (error) {
        console.error("Error during periodic sync with Appwrite:", error);
      }
    }, 5000);
    return () => {
      clearInterval(syncInterval);
    };
  }, []);

  useEffect(() => {
    localStorage.setItem("serve-tracker-clients", JSON.stringify(clients));
    console.log("Updated localStorage serve-tracker-clients:", clients.length, "clients");
  }, [clients]);

  useEffect(() => {
    localStorage.setItem("serve-tracker-serves", JSON.stringify(serves));
    console.log("Updated localStorage serve-tracker-serves:", serves.length, "entries");
  }, [serves]);

  const createClient = async (client) => {
    try {
      console.log("Creating new client:", client);
      const newClient = await appwrite.createClient({
        name: client.name,
        email: client.email,
        additionalEmails: client.additionalEmails || [],
        phone: client.phone,
        address: client.address,
        notes: client.notes
      });
      
      if (newClient) {
        toast({
          title: "Client created",
          description: "New client has been added successfully",
          variant: "success",
        });
        
        const clientData = {
          id: newClient.$id,
          name: newClient.name,
          email: newClient.email,
          additionalEmails: newClient.additional_emails || [],
          phone: newClient.phone,
          address: newClient.address,
          notes: newClient.notes || "",
        };
        
        setClients(prev => [...prev, clientData]);
        
        setTimeout(() => {
          loadAppwriteData();
        }, 500);
        
        return clientData;
      }
    } catch (error) {
      console.error("Error creating client in Appwrite:", error);
      toast({
        title: "Error creating client",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
      throw error;
    }
  };

  const updateClient = async (updatedClient) => {
    try {
      console.log("Updating client in Appwrite:", updatedClient);
      
      // Ensure we're sending the correct structure
      const clientData = {
        name: updatedClient.name,
        email: updatedClient.email,
        additionalEmails: updatedClient.additionalEmails || [],
        phone: updatedClient.phone,
        address: updatedClient.address,
        notes: updatedClient.notes || "",
      };
      
      console.log("Prepared client data:", clientData);
      
      const result = await appwrite.updateClient(updatedClient.id, clientData);
      
      if (result) {
        toast({
          title: "Client updated",
          description: "Client has been successfully updated",
          variant: "success",
        });
        
        // Make sure we map the data correctly to account for field name differences
        const updatedClientWithSchema = {
          id: result.$id,
          name: result.name,
          email: result.email,
          additionalEmails: result.additional_emails || [],
          phone: result.phone,
          address: result.address,
          notes: result.notes || "",
        };
        
        setClients((prev) =>
          prev.map((client) =>
            client.id === updatedClient.id ? updatedClientWithSchema : client
          )
        );
        
        setTimeout(() => {
          loadAppwriteData();
        }, 500);
        
        return true;
      }
      return false;
    } catch (error) {
      console.error("Error updating client in Appwrite:", error);
      console.error("Error details:", error.response || error.message);
      
      toast({
        title: "Error updating client",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
      throw error;
    }
  };

  const deleteClient = async (clientId) => {
    try {
      console.log(`Starting deletion process for client ${clientId}`);

      // First delete serve attempts
      const serveAttempts = await appwrite.getServeAttempts();
      const clientServes = serveAttempts.filter(serve => serve.client_id === clientId);
      console.log(`Found ${clientServes.length} serve attempts to delete`);

      for (const serve of clientServes) {
        if (!serve.$id) {
          console.warn("Skipping serve attempt with missing ID:", serve);
          continue;
        }
        await appwrite.deleteServeAttempt(serve.$id);
      }

      // Delete documents
      const documents = await appwrite.getClientDocuments(clientId);
      console.log(`Found ${documents.length} documents to delete`);

      for (const doc of documents) {
        await appwrite.deleteClientDocument(doc.$id, doc.file_path);
      }

      // Delete the client
      console.log(`Deleting client ${clientId}`);
      await appwrite.deleteClient(clientId);

      // Update local state
      setClients(prev => prev.filter(client => client.id !== clientId));
      setServes(prev => prev.filter(serve => serve.clientId !== clientId));

      toast({
        title: "Client deleted",
        description: "Client and associated data have been removed",
        variant: "success",
      });
    } catch (error) {
      console.error("Error deleting client:", error);
      toast({
        title: "Error deleting client",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const createServe = async (serveData) => {
    try {
      const newServe = await appwrite.createServeAttempt(serveData);

      const formattedServe = {
        id: newServe.$id, // Map $id to id
        ...newServe,
        timestamp: new Date(newServe.timestamp || new Date()),
      };

      setServes((prev) => [...prev, formattedServe]);

      // Send email notification
      const emailBody = createServeEmailBody(
        serveData.clientName || "Unknown Client",
        serveData.address || "Unknown Address",
        serveData.notes || "No notes provided",
        new Date(formattedServe.timestamp),
        serveData.coordinates || { latitude: 0, longitude: 0 },
        serveData.attemptNumber || 1,
        serveData.caseNumber
      );

      const recipients = serveData.clientEmail
        ? [serveData.clientEmail, "info@justlegalsolutions.org"]
        : ["info@justlegalsolutions.org"];

      const emailResult = await sendEmail({
        to: recipients,
        subject: `New Serve Attempt Created - ${serveData.caseNumber || "Unknown Case"}`,
        body: emailBody,
        html: emailBody,
      });

      if (emailResult.success) {
        console.log("Email sent successfully:", emailResult.message);
      } else {
        console.error("Failed to send email:", emailResult.message);
      }

      toast({
        title: "Serve recorded",
        description: "Service attempt has been saved successfully",
        variant: "success",
      });

      return true;
    } catch (error) {
      console.error("Error creating serve attempt:", error);
      toast({
        title: "Error saving serve attempt",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
      return false;
    }
  };

  const updateServe = async (serveData) => {
    try {
      // Create a proper payload with converted timestamp
      const timestamp = serveData.timestamp ? 
        (serveData.timestamp instanceof Date ? 
          serveData.timestamp : 
          new Date(serveData.timestamp)) : 
        new Date();
      
      // Prepare the payload without relying on timestamp methods
      const payload = {
        client_id: serveData.clientId,
        case_number: serveData.caseNumber || null,
        case_name: serveData.caseName || "Unknown Case",
        status: serveData.status || "unknown",
        notes: serveData.notes || "",
        coordinates: serveData.coordinates || null,
        image_data: serveData.imageData || null,
        timestamp: timestamp.toISOString(),
        attempt_number: serveData.attemptNumber || 1
      };

      const updatedServe = await appwrite.updateServeAttempt(serveData.id, payload);

      // Ensure the `id` field is preserved
      const formattedServe = {
        id: serveData.id,
        ...updatedServe,
        timestamp: timestamp
      };

      setServes((prev) =>
        prev.map((serve) => (serve.id === serveData.id ? formattedServe : serve))
      );

      toast({
        title: "Serve updated",
        description: "Service attempt has been updated successfully",
        variant: "success",
      });

      return true;
    } catch (error) {
      console.error("Error updating serve attempt:", error);
      toast({
        title: "Error updating serve attempt",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
      return false;
    }
  };

  const deleteServe = async (serveId) => {
    try {
      const serve = serves.find((s) => s.id === serveId);
      if (!serve) throw new Error("Serve not found");

      await appwrite.deleteServeAttempt(serveId);

      setServes((prev) => prev.filter((s) => s.id !== serveId));

      // Send email notification
      const emailBody = createDeleteNotificationEmail(
        serve.clientName,
        serve.caseNumber,
        new Date(serve.timestamp),
        "Serve attempt was deleted by the admin."
      );

      const emailResult = await sendEmail({
        to: serve.clientEmail || "info@justlegalsolutions.org",
        subject: `Serve Attempt Deleted - ${serve.caseNumber}`,
        body: emailBody,
        html: emailBody,
      });

      if (emailResult.success) {
        console.log("Email sent successfully:", emailResult.message);
      } else {
        console.error("Failed to send email:", emailResult.message);
      }

      toast({
        title: "Serve deleted",
        description: "Service attempt has been removed",
        variant: "success",
      });
    } catch (error) {
      console.error("Error deleting serve attempt:", error);
      toast({
        title: "Error deleting serve attempt",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const formatServesForDisplay = (serves) => {
    const normalizedServes = normalizeServeDataArray(serves);
    return normalizedServes.map((serve) => ({
      id: serve.id || "unknown", // Fallback to "unknown" if `id` is missing
      clientId: serve.clientId || "unknown",
      date: serve.date || "N/A",
      time: serve.time || "N/A",
      address: serve.address || "N/A",
      ...serve,
    })); // Add semicolon here
  };

  return (
    <>
      {showAppwriteAlert && (
        <Alert className="m-4">
          <AlertTitle>Connection Warning</AlertTitle>
          <AlertDescription>
            Unable to connect to Appwrite. Operating in offline mode with local storage.
            <div className="mt-2">
              <Button
                variant="outline" 
                size="sm"
                onClick={() => window.location.reload()}
              >
                Try Again
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}
      <Routes location={location}>
        <Route element={<Layout />}>
          <Route path="/" element={<Index />} />
          <Route path="/dashboard" element={
            <Dashboard clients={clients} serves={serves} />
          } />
          <Route path="/new-serve" element={
            <NewServe clients={clients} addServe={createServe} />
          } />
          <Route path="/new-serve/:clientId" element={
            <NewServe clients={clients} addServe={createServe} />
          } />
          <Route path="/clients" element={
            <Clients 
              clients={clients} 
              addClient={createClient}
              updateClient={updateClient}
              deleteClient={deleteClient}
            />
          } />
          <Route path="/history" element={
            <History 
              serves={formatServesForDisplay(serves)} 
              clients={clients}
              deleteServe={deleteServe}
              updateServe={updateServe}
            />
          } />
          <Route path="/migration" element={<MigrationPage />} />
          <Route path="/export" element={<DataExport />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
      </Routes>
    </>
  );
};

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AnimatedRoutes />
    </QueryClientProvider>
  );
}
