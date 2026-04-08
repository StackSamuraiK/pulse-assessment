import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Markdown from 'markdown-to-jsx';
import { Send, Bot, User, Sparkles, BookOpen, Clock, Loader2, Database, Globe } from 'lucide-react';
import { sendChatMessage, fetchHistory, type ChatMessage } from './lib/api';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Separator } from '@/components/ui/separator';

const USER_ID = 'user-123'; // Default user for demo

export default function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [currentResponse, setCurrentResponse] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  function scrollToBottom() {
    setTimeout(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    }, 100);
  }

  useEffect(() => {
    // Fetch history on load
    fetchHistory(USER_ID).then((history) => {
      setMessages(history);
      scrollToBottom();
    });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, currentResponse]);

  // We use handleSend instead of handleSubmit

  const handleSend = async (text: string) => {
    if (!text.trim() || isLoading) return;

    const userMessage: ChatMessage = { role: 'user', content: text };
    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);
    
    let completeResponse = '';

    await sendChatMessage(
      USER_ID,
      text,
      (chunk) => {
        completeResponse += chunk;
        setCurrentResponse(completeResponse);
      },
      (meta) => {
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: completeResponse,
            source: meta.source as ChatMessage['source'],
            citations: meta.citations,
          },
        ]);
        setCurrentResponse('');
        setIsLoading(false);
      },
      (err) => {
        setMessages((prev) => [...prev, { role: 'assistant', content: `**Error:** ${err}` }]);
        setIsLoading(false);
      }
    );
  };

  const getSourceIcon = (source?: string) => {
    switch (source) {
      case 'rag': return <Database className="w-4 h-4 text-blue-500" />;
      case 'live': return <Globe className="w-4 h-4 text-amber-500" />;
      case 'hybrid': return <Sparkles className="w-4 h-4 text-purple-500" />;
      case 'cache': return <Clock className="w-4 h-4 text-green-500" />;
      default: return null;
    }
  };

  const getSourceColor = (source?: string) => {
    switch (source) {
      case 'rag': return 'bg-blue-500/10 text-blue-500 border-blue-500/20';
      case 'live': return 'bg-amber-500/10 text-amber-500 border-amber-500/20';
      case 'hybrid': return 'bg-purple-500/10 text-purple-500 border-purple-500/20';
      case 'cache': return 'bg-green-500/10 text-green-500 border-green-500/20';
      default: return 'bg-gray-500/10 text-gray-500 border-gray-500/20';
    }
  };

  return (
    <TooltipProvider>
      <div className="flex h-screen bg-background text-foreground overflow-hidden font-sans">
        
        {/* Sidebar */}
        <motion.aside 
          initial={{ x: -300 }}
          animate={{ x: 0 }}
          className="w-72 border-r border-border/40 bg-card/30 backdrop-blur-xl hidden md:flex flex-col"
        >
          <div className="p-6 flex items-center gap-3">
            <div className="bg-primary/10 p-2 rounded-xl text-primary">
              <Sparkles className="w-6 h-6" />
            </div>
            <div>
              <h1 className="font-bold text-lg leading-tight tracking-tight">SlackAgent</h1>
              <p className="text-xs text-muted-foreground font-medium">RAG + Live Docs</p>
            </div>
          </div>
          
          <Separator className="opacity-50" />
          
          <div className="flex-1 p-4">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4 px-2">Conversations</h2>
            <div className="bg-secondary/50 p-3 rounded-xl cursor-pointer border border-border/40 hover:bg-secondary transition-colors">
              <div className="flex items-center gap-3">
                <BookOpen className="w-4 h-4 text-primary" />
                <span className="text-sm font-medium">Current Session</span>
              </div>
            </div>
          </div>

          <div className="p-4 mt-auto">
            <div className="bg-gradient-to-r from-primary/10 to-transparent p-4 rounded-xl border border-primary/10">
              <p className="text-xs text-muted-foreground">Logged in as</p>
              <p className="text-sm font-semibold mt-1">User 123</p>
            </div>
          </div>
        </motion.aside>

        {/* Main Chat Area */}
        <main className="flex-1 flex flex-col relative bg-gradient-to-b from-background to-secondary/20">
          
          {/* Header */}
          <header className="h-16 flex items-center px-6 border-b border-border/40 bg-background/50 backdrop-blur-md sticky top-0 z-10 shrink-0">
            <h2 className="font-semibold px-2 md:px-0">Slack Documentation Assistant</h2>
          </header>

          {/* Chat Messages */}
          <div 
            ref={scrollRef}
            className="flex-1 overflow-y-auto px-4 py-8 md:px-12 scroll-smooth"
          >
            <div className="max-w-3xl mx-auto space-y-8 flex flex-col justify-end min-h-full">
              
              <AnimatePresence>
                {messages.length === 0 && !isLoading && (
                  <motion.div 
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex flex-col items-center justify-center text-center space-y-4 my-auto opacity-50 py-20"
                  >
                    <div className="p-4 bg-secondary rounded-full">
                      <Bot className="w-8 h-8 text-muted-foreground" />
                    </div>
                    <h3 className="text-xl font-medium text-foreground">How can I help you today?</h3>
                    <p className="text-sm text-muted-foreground max-w-sm">
                      Ask me anything about Slack APIs, Block Kit, Events, or Workflows.
                    </p>
                  </motion.div>
                )}
                
                {messages.map((msg, idx) => (
                  <motion.div
                    key={idx}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3 }}
                    className={`flex gap-4 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    {msg.role === 'assistant' && (
                      <Avatar className="w-8 h-8 border border-border/50 shrink-0">
                        <AvatarFallback className="bg-primary/10 text-primary"><Bot size={16}/></AvatarFallback>
                      </Avatar>
                    )}
                    
                    <div className={`flex flex-col gap-2 max-w-[85%] ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                      <div 
                        className={`rounded-2xl px-5 py-3.5 shadow-sm leading-relaxed text-[15px]
                          ${msg.role === 'user' 
                            ? 'bg-primary text-primary-foreground rounded-br-none' 
                            : 'bg-card border border-border/40 rounded-bl-none text-card-foreground prose prose-pre:bg-secondary prose-pre:text-secondary-foreground prose-a:text-primary dark:prose-invert max-w-none'
                          }`
                        }
                      >
                        {msg.role === 'user' ? (
                          msg.content
                        ) : (
                          <Markdown>{msg.content}</Markdown>
                        )}
                      </div>

                      {/* Source Badge */}
                      {msg.source && (
                        <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${getSourceColor(msg.source)} backdrop-blur-sm`}>
                          {getSourceIcon(msg.source)}
                          <span className="capitalize">{msg.source}</span>
                        </div>
                      )}
                    </div>

                    {msg.role === 'user' && (
                      <Avatar className="w-8 h-8 border border-border/50 shrink-0">
                        <AvatarFallback className="bg-secondary text-secondary-foreground"><User size={16}/></AvatarFallback>
                      </Avatar>
                    )}
                  </motion.div>
                ))}

                {/* Streaming Response Indicator */}
                {isLoading && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex gap-4 justify-start"
                  >
                    <Avatar className="w-8 h-8 border border-border/50 shrink-0">
                      <AvatarFallback className="bg-primary/10 text-primary"><Bot size={16}/></AvatarFallback>
                    </Avatar>
                    <div className="flex flex-col gap-2 max-w-[85%] items-start">
                      <div className="rounded-2xl px-5 py-3.5 shadow-sm leading-relaxed text-[15px] bg-card border border-border/40 rounded-bl-none prose prose-p:my-0 dark:prose-invert">
                        {currentResponse ? (
                           <Markdown>{currentResponse}</Markdown>
                        ) : (
                          <div className="flex items-center gap-2 text-muted-foreground h-6">
                            <Loader2 className="w-4 h-4 animate-spin" />
                            <span className="text-sm">Thinking & Crawling...</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Input Area */}
          <div className="p-4 md:p-6 bg-gradient-to-t from-background via-background to-transparent pb-8 shrink-0">
            <div className="max-w-3xl mx-auto relative">
              <form 
                onSubmit={(e) => { e.preventDefault(); handleSend(input); }}
                className="relative bg-card rounded-3xl shadow-sm border border-border/60 overflow-hidden focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary/50 transition-all"
              >
                <div className="flex items-end px-4 py-3">
                  <textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSend(input);
                      }
                    }}
                    placeholder="Ask about Slack docs..."
                    disabled={isLoading}
                    className="w-full max-h-32 min-h-[44px] bg-transparent resize-none outline-none text-[15px] py-2.5 disabled:opacity-50"
                    rows={1}
                  />
                  <div className="shrink-0 mb-1 ml-2">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button 
                          type="submit" 
                          size="icon" 
                          disabled={!input.trim() || isLoading}
                          className="rounded-full w-10 h-10 shadow-md transition-transform hover:scale-105 active:scale-95 disabled:scale-100 disabled:opacity-50"
                        >
                          {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4 ml-0.5" />}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Send message</TooltipContent>
                    </Tooltip>
                  </div>
                </div>
              </form>
              <div className="text-center mt-3">
                <p className="text-[11px] text-muted-foreground/70 font-medium tracking-wide">
                  AI answers directly from docs.slack.dev. Results may vary based on live updates.
                </p>
              </div>
            </div>
          </div>

        </main>
      </div>
    </TooltipProvider>
  );
}
